import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnnounceFrame, ExpelAckFrame, ExpelFrame, Node } from "@tau/protocol";
import { generateNodeKeys, nodeIdOf, signPayload } from "@tau/protocol/identity";
import { createChangeEmitter } from "../../change-emitter";
import type { NodeIdentity } from "../../identity/node-identity";
import { createDirectory } from "./create-directory";
import type { Directory } from "./ports";

export interface TestNode {
  readonly name: string;
  readonly id: string;
  readonly home: string;
  readonly dir: Directory;
  readonly forgotten: string[];
  readonly peers: Map<string, string>;
  setIdentity(keys: ReturnType<typeof generateNodeKeys>): void;
}

export const clock = { now: 1_000_000 };

/** A directory with a fake `nodes` port: peers are the ids passed to `link`. */
export async function makeNode(name: string, home?: string): Promise<TestNode> {
  const dir0 = home ?? (await mkdtemp(join(tmpdir(), "tau-dir-")));
  let keys = generateNodeKeys();
  const toIdentity = (k: typeof keys): NodeIdentity => ({
    nodeId: nodeIdOf(k.publicKey),
    publicKey: k.publicKey,
    createdAt: 0,
    sign: (payload) => signPayload(k, payload),
  });
  const peers = new Map<string, string>();
  const forgotten: string[] = [];
  const node: TestNode = {
    name,
    get id() {
      return nodeIdOf(keys.publicKey);
    },
    home: dir0,
    forgotten,
    peers,
    setIdentity: (next) => {
      keys = next;
    },
    dir: createDirectory({
      expelledFile: join(dir0, "expelled.json"),
      home: dir0,
      now: () => clock.now,
      changes: createChangeEmitter(),
      identity: () => toIdentity(keys),
      nodes: {
        list: async () =>
          [...peers].map(
            ([id, peerName]) =>
              ({
                id,
                identified: true,
                name: peerName,
                os: "linux x64",
                tauVersion: "1",
                protocolVersion: "v",
                status: "online",
                lastSeenAt: clock.now,
                threadCount: 0,
                links: [{ direction: "dialled", status: "online" }],
              }) as unknown as Node,
          ),
        forget: async (id) => {
          forgotten.push(id);
        },
      },
      self: () => ({
        name,
        os: "linux x64",
        tauVersion: "1",
        protocolVersion: "v",
        linkProtocol: "l",
        threadCount: 0,
      }),
    }),
  };
  return node;
}

/** Plays the server: link-up, expel-set sync, announce flooding, expel flooding with acks. */
export function createNetwork(nodes: TestNode[]) {
  const byId = (id: string) => nodes.find((n) => n.id === id) as TestNode;
  const edges = new Set<string>();
  const key = (a: TestNode, b: TestNode) => [a.id, b.id].sort().join(">");
  const connected = (n: TestNode) => [...n.peers.keys()].filter((id) => edges.has(key(n, byId(id))));
  async function link(a: TestNode, b: TestNode) {
    edges.add(key(a, b));
    a.peers.set(b.id, b.name);
    b.peers.set(a.id, a.name);
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const)
      x.dir.group.linkUp(y.id);
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      await x.dir.group.acceptExpelSet(await y.dir.group.expelSet(), y.id);
    }
  }
  async function flood(from: TestNode, source: TestNode | undefined, frame: AnnounceFrame) {
    for (const id of connected(from)) {
      const to = byId(id);
      if (to === source) continue;
      const out = await to.dir.group.acceptAnnounce(frame, from.id);
      if (out.accepted && out.forwardTtl !== undefined) {
        await flood(to, from, { ...frame, ttl: out.forwardTtl });
      }
    }
  }
  async function announceAll(rounds = 3, who: TestNode[] = nodes) {
    for (let i = 0; i < rounds; i++) {
      for (const n of who) await flood(n, undefined, await n.dir.group.localAnnounce());
    }
  }
  async function floodExpel(from: TestNode, source: TestNode | undefined, frame: ExpelFrame) {
    for (const id of connected(from)) {
      const to = byId(id);
      if (to === source) continue;
      const out = await to.dir.group.acceptExpel(frame, from.id);
      if (out.ack) await floodAck(to, undefined, out.ack);
      if (out.reflood) await floodExpel(to, from, frame);
    }
  }
  async function floodAck(from: TestNode, source: TestNode | undefined, ack: ExpelAckFrame) {
    for (const id of connected(from)) {
      const to = byId(id);
      if (to === source) continue;
      const out = await to.dir.group.acceptAck(ack, from.id);
      if (out.reflood) await floodAck(to, from, ack);
    }
  }
  return {
    link,
    announceAll,
    floodExpel,
    cut(n: TestNode) {
      for (const id of connected(n)) edges.delete(key(n, byId(id)));
    },
    reconnect: async (a: TestNode, b: TestNode) => link(a, b),
  };
}
