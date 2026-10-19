import {
  AppError,
  type Change,
  type Core,
  type DirectoryNode,
  type ExpelFrame,
  LINK_PROTOCOL,
  NODE_CAPABILITIES,
  type Node,
  type NodeLink,
  type NodeLinkDirection,
  type NodeLinkReport,
  type NodeSelf,
  type NodeStatus,
  type NodeSummary,
  PROTOCOL_VERSION,
} from "@tau/protocol";
import type { FakeAccess } from "./fake-access";
import type { FakeGroupBus } from "./fake-group-bus";

export interface FakeNodes {
  readonly api: Core["nodes"];
  /** This fake's own `nodeId` right now (it changes with `resetIdentity`). */
  readonly nodeId: () => string;
  /** `api.self()` without the promise, so linking and seeding stay synchronous. */
  readonly selfSync: () => NodeSelf;
  /** Plays what the link would do: a node goes offline, reconnecting or `update-required`. */
  setStatus(nodeId: string, status: NodeStatus): void;
  /** A `peers.json` entry that is dialled but not yet linked: returns its peer id. */
  addDialledPeer(name: string): string;
  /** A node known only through the group: `hops` away, handed over by `via` (a direct peer's id). */
  addRouted(node: Node, via: string, hops: number): void;
  /** Joins a fake group: expels reach the other members through `bus`. */
  joinGroup(bus: FakeGroupBus): void;
}

export interface FakeNodesOptions {
  readonly now: () => number;
  readonly emit: (change: Change) => void;
  readonly access: Pick<FakeAccess, "revokeDevice" | "renameDevice" | "listDevices">;
  /** This fake's name, os and version as `nodes.self()` reports them. */
  readonly self?: { readonly name?: string; readonly os?: string; readonly tauVersion?: string };
}

/** The two nodes a group with `nodes: true` starts with: one online, one offline. */
export const FAKE_NODE_SEEDS = [
  { name: "Homelab", os: "linux x64", tauVersion: "0.0.0", threadCount: 3, status: "online" },
  { name: "Work laptop", os: "win32 x64", tauVersion: "0.0.0", threadCount: 1, status: "offline" },
] as const;

let nodeCounter = 0;
const newNodeId = () => `fake-node-${++nodeCounter}`;

/** A working in-memory registry, the executable spec for `core/src/nodes`: peers from both directions, per-peer links. */
export function createFakeNodes({ now, emit, access, self }: FakeNodesOptions): FakeNodes {
  let nodeId = newNodeId();
  const nodes = new Map<string, Node>();
  const summaries = new Map<string, NodeSummary>();
  const routed = new Map<string, { node: Node; via: string; hops: number }>();
  const tombstones = new Set<string>();
  let removed: { by: string; at: number } | undefined;
  let bus: FakeGroupBus | undefined;
  const deviceOf = new Map<string, string>();
  const announce = () => emit({ resource: "nodes" });
  const set = (node: Node) => {
    nodes.set(node.id, node);
    announce();
    return node;
  };
  const require = (id: string) => {
    const node = nodes.get(id);
    if (!node) throw new AppError("not_found", `No node ${id}.`);
    return node;
  };
  const withLink = (links: readonly NodeLink[], link: NodeLink): NodeLink[] => [
    ...links.filter((entry) => entry.direction !== link.direction),
    link,
  ];
  const linked = (direction: NodeLinkDirection): NodeLink => ({
    direction,
    state: "linked",
    message: null,
    since: now(),
  });
  async function drop(id: string) {
    nodes.delete(id);
    summaries.delete(id);
    const device = deviceOf.get(id) ?? id;
    deviceOf.delete(id);
    await access.revokeDevice(device);
    announce();
  }
  /** Like the real core: an id may be a node id or a device id (a link refused before it registered). */
  async function dropOrRevoke(id: string) {
    if (nodes.has(id)) await drop(id);
    else await access.revokeDevice(id);
  }
  const selfSync = (): NodeSelf => ({
    nodeId,
    publicKey: `fake-key-${nodeId}`,
    name: self?.name ?? "Mac",
    os: self?.os ?? "darwin arm64",
    tauVersion: self?.tauVersion ?? "0.0.0",
    protocolVersion: PROTOCOL_VERSION,
    linkProtocol: LINK_PROTOCOL,
    capabilities: [...NODE_CAPABILITIES],
    ...(removed ? { removed } : {}),
  });
  const directoryOf = (): DirectoryNode[] => {
    const direct = [...nodes.values()].map(
      (node): DirectoryNode => ({
        ...node,
        links: node.links.map((link) => ({ ...link })),
        direct: true,
        hops: 1,
        nextHop: node.id,
        via: null,
        skewMs: null,
        ghost: false,
        unsynced: false,
      }),
    );
    const far = [...routed.values()].map(
      ({ node, via, hops }): DirectoryNode => ({
        ...node,
        links: [],
        direct: false,
        hops,
        nextHop: via,
        via: nodes.get(via)?.name ?? null,
        skewMs: null,
        ghost: node.status === "offline",
        unsynced: false,
      }),
    );
    return [...direct, ...far];
  };
  const inert = (what: string) => () => Promise.reject(new AppError("internal", `Not implemented: ${what}`));
  const group: Core["nodes"]["group"] = {
    localAnnounce: inert("fake NodeGroup.localAnnounce"),
    linkUp: () => undefined,
    linkDown: () => undefined,
    acceptAnnounce: inert("fake NodeGroup.acceptAnnounce"),
    acceptExpel: inert("fake NodeGroup.acceptExpel"),
    acceptAck: inert("fake NodeGroup.acceptAck"),
    expelSet: async () => [],
    acceptExpelSet: inert("fake NodeGroup.acceptExpelSet"),
    markUnsynced: () => undefined,
    async createExpel(target, confirm) {
      if (target === nodeId) throw new AppError("cannot_remove_self", "A node cannot remove itself.");
      const known = directoryOf().find((node) => node.id === target);
      if (!known) throw new AppError("not_found", `No node ${target}.`);
      if (confirm !== known.name && confirm !== known.id) {
        throw new AppError("confirmation_mismatch", "Type the node's name or id to confirm.");
      }
      bus?.expel(nodeId, target, now());
      return {
        type: "expel",
        payload: `tau-expel-v1|${target}|${nodeId}|${now()}`,
        byPublicKey: `fake-key-${nodeId}`,
        sig: "fake-sig",
      } satisfies ExpelFrame;
    },
    route: (dest) => {
      const far = routed.get(dest);
      if (far) return { dest, nextHop: far.via, hops: far.hops };
      return nodes.has(dest) ? { dest, nextHop: dest, hops: 1 } : undefined;
    },
    isTombstoned: (id) => tombstones.has(id),
    neighbours: () => [...nodes.keys()],
    onTopology: () => () => undefined,
    onTombstone: () => () => undefined,
    recordSkew: () => undefined,
  };
  const api: Core["nodes"] = {
    self: async () => selfSync(),
    sign: async (payload) => `fake-sig:${payload}`,
    async list() {
      return [...nodes.values()].map((node) => ({ ...node, links: node.links.map((link) => ({ ...link })) }));
    },
    async rename(id, name) {
      const node = require(id);
      await access.renameDevice(deviceOf.get(id) ?? id, name).catch(() => undefined);
      set({ ...node, name });
    },
    async disconnect(id) {
      await dropOrRevoke(id);
    },
    async forget(id) {
      await dropOrRevoke(id);
    },
    async resetIdentity() {
      for (const id of [...nodes.keys()]) await drop(id);
      if (removed) tombstones.clear();
      removed = undefined;
      nodeId = newNodeId();
      announce();
    },
    reportLink(peerId, state: NodeLinkReport) {
      const node = nodes.get(peerId);
      if (!node) return;
      set({ ...node, links: withLink(node.links, { direction: "dialled", ...state }) });
    },
    async register(peerId, info, direction) {
      const id = info.nodeId ?? peerId;
      if (id !== peerId) deviceOf.set(id, peerId);
      const status = info.protocolVersion === PROTOCOL_VERSION ? "online" : "update-required";
      const previous = nodes.get(id) ?? nodes.get(peerId);
      nodes.delete(peerId);
      return set({
        threadCount: previous?.threadCount ?? 0,
        ...info,
        id,
        identified: info.nodeId !== undefined,
        status,
        lastSeenAt: now(),
        links: withLink(previous?.links ?? [], linked(direction)),
      });
    },
    heartbeat(id, threadCount) {
      const node = nodes.get(id);
      if (!node) return;
      nodes.set(id, { ...node, lastSeenAt: now(), threadCount: threadCount ?? node.threadCount });
    },
    markOffline(id) {
      const node = nodes.get(id);
      if (node && node.status !== "offline") {
        const links = node.links.map((link): NodeLink => ({ ...link, state: "unreachable" }));
        set({ ...node, status: "offline", lastSeenAt: now(), links });
      }
    },
    directory: async () => directoryOf(),
    expulsions: async () => bus?.expulsions() ?? [],
    group,
    async readSummary(id) {
      return summaries.get(id);
    },
    async writeSummary(id, summary) {
      require(id);
      summaries.set(id, summary);
    },
  };
  return {
    api,
    nodeId: () => nodeId,
    selfSync,
    addRouted(node, via, hops) {
      routed.set(node.id, { node, via, hops });
      announce();
    },
    joinGroup(next) {
      bus = next;
      next.join({
        get id() {
          return nodeId;
        },
        get name() {
          return self?.name ?? "Mac";
        },
        applyExpel({ target, by, at }) {
          tombstones.add(target);
          routed.delete(target);
          if (target === nodeId) {
            removed = { by, at };
            for (const id of [...nodes.keys()]) nodes.delete(id);
            routed.clear();
            announce();
          } else void dropOrRevoke(target);
        },
      });
    },
    setStatus(id, status) {
      set({ ...require(id), status, lastSeenAt: now() });
    },
    addDialledPeer(name) {
      const id = `u-${++nodeCounter}`;
      set({
        id,
        identified: false,
        name,
        os: "",
        tauVersion: "",
        protocolVersion: "",
        status: "offline",
        lastSeenAt: 0,
        threadCount: 0,
        links: [{ direction: "dialled", state: "connecting", message: null, since: now() }],
      });
      return id;
    },
  };
}
