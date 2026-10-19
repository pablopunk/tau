import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnnounceFrame, Core, ExpelAckFrame, ExpelFrame, ExpelOutcome } from "@tau/protocol";
import type { ContractGroup } from "@tau/testkit/contract";
import { type CoreDependencies, createCoreWith, defaultCoreDependencies } from "../create-core";
import { peerIdOf } from "../nodes/peer-id";
import { createFilePeersStore, type Peer, peersFilePath } from "../peers/peers-store";
import { createFakeRemoteAdapter } from "../remote/fake-adapter";
import { createScriptedShellDaemon } from "../terminals/scripted-shell-daemon";
import { NO_UPDATE_OPTIONS } from "./update-options";

type Key = "a" | "b" | "c";
interface Member {
  readonly key: Key;
  readonly name: string;
  readonly home: string;
  readonly core: Core;
  readonly id: string;
  readonly peers: ReturnType<typeof createFilePeersStore>;
}

const NAMES: Record<Key, string> = { a: "Alpha", b: "Bravo", c: "Charlie" };
const EDGES: ReadonlyArray<readonly [Key, Key]> = [
  ["a", "b"],
  ["b", "c"],
];

async function startMember(root: string, key: Key): Promise<Member> {
  const home = join(root, key);
  const deps: CoreDependencies = {
    ...defaultCoreDependencies(),
    env: { ...process.env, TAU_NODE_NAME: NAMES[key] },
    remoteAdapter: () => createFakeRemoteAdapter(),
    terminalDaemon: createScriptedShellDaemon(),
  };
  const core = await createCoreWith({ home, faux: true, ...NO_UPDATE_OPTIONS }, deps);
  return {
    key,
    name: NAMES[key],
    home,
    core,
    id: (await core.nodes.self()).nodeId,
    peers: createFilePeersStore(peersFilePath(home)),
  };
}

/**
 * Three real cores A-B-C (A-B and B-C linked) on scratch homes. This plays the server's part in memory:
 * link-up, expel-set sync, announce and expel flooding, acks. There are no sockets.
 */
export async function createRealGroup(): Promise<ContractGroup> {
  const root = await mkdtemp(join(tmpdir(), "tau-real-group-"));
  const members = {
    a: await startMember(root, "a"),
    b: await startMember(root, "b"),
    c: await startMember(root, "c"),
  };
  const edges = new Set<string>();
  const edgeKey = (x: Key, y: Key) => [x, y].sort().join("");
  const neighbours = (key: Key): Key[] =>
    (["a", "b", "c"] as Key[]).filter((other) => edges.has(edgeKey(key, other)));
  const group = (key: Key) => members[key].core.nodes.group;

  async function register(from: Member, to: Member): Promise<void> {
    const peer: Peer = {
      url: `https://${to.name.toLowerCase()}.example`,
      name: to.name,
      secret: `s-${to.name}`,
    };
    const known = await from.peers.read();
    if (!known.some((entry) => peerIdOf(entry) === peerIdOf(peer) || entry.nodeId === to.id))
      await from.peers.write([...known, peer]);
    const self = await to.core.nodes.self();
    await from.core.nodes.register(
      peerIdOf(known.find((entry) => entry.nodeId === to.id) ?? peer),
      { ...self, nodeId: to.id },
      "dialled",
    );
  }

  async function settle(at: Key, from: Key, outcome: ExpelOutcome, frame: ExpelFrame): Promise<void> {
    if (outcome.ack) await floodAck(at, undefined, outcome.ack);
    if (outcome.reflood) await floodExpel(at, from, frame);
  }

  async function link(x: Key, y: Key): Promise<void> {
    edges.add(edgeKey(x, y));
    await register(members[x], members[y]);
    await register(members[y], members[x]);
    group(x).linkUp(members[y].id);
    group(y).linkUp(members[x].id);
    for (const [at, from] of [
      [x, y],
      [y, x],
    ] as const) {
      const frames = await group(from).expelSet();
      const outcomes = await group(at).acceptExpelSet(frames, members[from].id);
      for (const [index, outcome] of outcomes.entries())
        await settle(at, from, outcome, frames[index] as ExpelFrame);
    }
  }

  async function floodAnnounce(from: Key, source: Key | undefined, frame: AnnounceFrame): Promise<void> {
    for (const to of neighbours(from)) {
      if (to === source) continue;
      const out = await group(to).acceptAnnounce(frame, members[from].id);
      if (out.accepted && out.forwardTtl !== undefined)
        await floodAnnounce(to, from, { ...frame, ttl: out.forwardTtl });
    }
  }

  async function floodExpel(from: Key, source: Key | undefined, frame: ExpelFrame): Promise<void> {
    for (const to of neighbours(from)) {
      if (to === source) continue;
      const out = await group(to).acceptExpel(frame, members[from].id);
      if (out.ack) await floodAck(to, undefined, out.ack);
      if (out.reflood) await floodExpel(to, from, frame);
    }
  }

  async function floodAck(from: Key, source: Key | undefined, ack: ExpelAckFrame): Promise<void> {
    for (const to of neighbours(from)) {
      if (to === source) continue;
      const out = await group(to).acceptAck(ack, members[from].id);
      if (out.reflood) await floodAck(to, from, ack);
    }
  }

  async function announceAll(rounds = 3): Promise<void> {
    for (let round = 0; round < rounds; round++)
      for (const key of ["a", "b", "c"] as Key[])
        await floodAnnounce(key, undefined, await group(key).localAnnounce());
  }

  for (const [x, y] of EDGES) await link(x, y);
  await announceAll();

  const withFlooding = (key: Key): Core => {
    const { core } = members[key];
    return {
      ...core,
      nodes: {
        ...core.nodes,
        group: {
          ...core.nodes.group,
          async createExpel(target, confirm) {
            const frame = await core.nodes.group.createExpel(target, confirm);
            await floodExpel(key, undefined, frame);
            return frame;
          },
        },
      },
    };
  };

  return {
    a: withFlooding("a"),
    b: withFlooding("b"),
    c: withFlooding("c"),
    ids: { a: members.a.id, b: members.b.id, c: members.c.id },
    cut(node) {
      for (const other of neighbours(node)) edges.delete(edgeKey(node, other));
    },
    async reconnect(node) {
      for (const [x, y] of EDGES) if (x === node || y === node) await link(x, y);
      await announceAll();
    },
    async dispose() {
      for (const key of ["a", "b", "c"] as Key[]) await members[key].core.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
