import { type Core, type ExpelFrame, type Route, STEP2_CAPABILITIES } from "@tau/protocol";
import { startTestServer } from "../../testing/harness";
import { createIdentityCore } from "../../testing/identity-core";
import { dial, type TestNode, waitOnline } from "../../testing/two-nodes";

type Group = Core["nodes"]["group"];

/** What a test steers and reads on the `NodeGroup` of one node (the real directory is core's job). */
export interface GroupControl {
  readonly routes: Map<string, Route>;
  readonly tombstones: Set<string>;
  readonly expels: ExpelFrame[];
  readonly skews: Array<[string, number]>;
  /** What this node's group heard, in order: `sync:<peer>`, `announce:<peer>:<ttl>`. */
  readonly heard: string[];
  /** Fires `onTopology` listeners: the relay re-announces. */
  topology(): void;
  tombstone(nodeId: string): void;
}

export interface ChainNode extends TestNode {
  readonly control: GroupControl;
}

/** A real server with a real key, the Step 2 capabilities and a steerable group. */
export async function startChainNode(name: string): Promise<ChainNode> {
  const identity = createIdentityCore(name);
  const nodes = identity.core.nodes;
  const self = nodes.self.bind(nodes);
  nodes.self = async () => ({ ...(await self()), capabilities: [...STEP2_CAPABILITIES] });
  const control = steerGroup(nodes);
  const ctx = await startTestServer({ core: identity.core });
  return {
    ...identity,
    name,
    ctx,
    control,
    stop: async () => {
      await ctx.server.close();
      await identity.core.close();
    },
  };
}

function steerGroup(nodes: Core["nodes"]): GroupControl {
  const routes = new Map<string, Route>();
  const tombstones = new Set<string>();
  const listeners = new Set<(target: string) => void>();
  const expels: ExpelFrame[] = [];
  const skews: Array<[string, number]> = [];
  const heard: string[] = [];
  const topologyListeners = new Set<() => void>();
  const base: Group = nodes.group;
  nodes.group = {
    ...base,
    route: (dest) => routes.get(dest),
    isTombstoned: (id) => tombstones.has(id),
    onTombstone(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onTopology(listener) {
      topologyListeners.add(listener);
      return () => topologyListeners.delete(listener);
    },
    recordSkew: (id, skew) => void skews.push([id, skew]),
    localAnnounce: async () => ({ type: "announce", payload: "tau-announce-v1|x", sig: "s", ttl: 4 }),
    expelSet: async () => [],
    acceptExpelSet: async (frames, from) => {
      heard.push(`sync:${from}`);
      return frames.map(() => ({ fresh: false, reflood: false, selfExpelled: false }));
    },
    acceptAnnounce: async (frame, from) => {
      heard.push(`announce:${from}:${frame.ttl}`);
      return { accepted: true, forwardTtl: 3 };
    },
    async acceptExpel(frame) {
      expels.push(frame);
      return { fresh: false, reflood: false, selfExpelled: false };
    },
    async createExpel(target, _confirm) {
      return { type: "expel", payload: `tau-expel-v1|${target}|by|1`, byPublicKey: "k", sig: "s" };
    },
  };
  return {
    routes,
    tombstones,
    expels,
    skews,
    heard,
    topology() {
      for (const listener of topologyListeners) listener();
    },
    tombstone(nodeId) {
      tombstones.add(nodeId);
      for (const listener of listeners) listener(nodeId);
    },
  };
}

export interface Chain {
  readonly a: ChainNode;
  readonly b: ChainNode;
  readonly c: ChainNode;
  stop(): Promise<void>;
}

/** A - B - C: A and C only reach each other through B. */
export async function startChain(): Promise<Chain> {
  const [a, b, c] = await Promise.all([
    startChainNode("Alpha"),
    startChainNode("Bravo"),
    startChainNode("Charlie"),
  ]);
  await connectChain(a, b, c);
  return { a, b, c, stop: async () => void (await Promise.all([a.stop(), b.stop(), c.stop()])) };
}

export async function connectChain(a: ChainNode, b: ChainNode, c: ChainNode): Promise<void> {
  const hop = (dest: ChainNode, via: ChainNode, hops: number): Route => ({
    dest: dest.nodeId,
    nextHop: via.nodeId,
    hops,
  });
  a.control.routes.set(c.nodeId, hop(c, b, 2));
  c.control.routes.set(a.nodeId, hop(a, b, 2));
  b.control.routes.set(a.nodeId, hop(a, a, 1));
  b.control.routes.set(c.nodeId, hop(c, c, 1));
  await dial(a, b);
  await dial(c, b);
  await Promise.all([waitOnline(a, b), waitOnline(b, a), waitOnline(c, b), waitOnline(b, c)]);
}
