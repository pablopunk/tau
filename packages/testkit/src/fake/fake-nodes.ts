import {
  AppError,
  type Change,
  type Core,
  HUB_LINK_NONE,
  type HubLink,
  type Node,
  type NodeStatus,
  type NodeSummary,
  PROTOCOL_VERSION,
} from "@tau/protocol";
import type { FakeAccess } from "./fake-access";

export interface FakeNodes {
  readonly api: Core["nodes"];
  /** Plays what the link would do: a node goes offline, reconnecting or `update-required`. */
  setStatus(nodeId: string, status: NodeStatus): void;
}

export interface FakeNodesOptions {
  readonly now: () => number;
  readonly emit: (change: Change) => void;
  readonly access: Pick<FakeAccess, "revokeDevice" | "renameDevice" | "listDevices">;
}

/** The two nodes a hub with `nodes: true` starts with: one online, one offline. */
export const FAKE_NODE_SEEDS = [
  { name: "Homelab", os: "linux x64", tauVersion: "0.0.0", threadCount: 3, status: "online" },
  { name: "Work laptop", os: "win32 x64", tauVersion: "0.0.0", threadCount: 1, status: "offline" },
] as const;

/** A working in-memory registry, the executable spec for `core/src/nodes`. */
export function createFakeNodes({ now, emit, access }: FakeNodesOptions): FakeNodes {
  const nodes = new Map<string, Node>();
  const summaries = new Map<string, NodeSummary>();
  let link: HubLink = HUB_LINK_NONE;
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
  const api: Core["nodes"] = {
    async list() {
      return [...nodes.values()].map((node) => ({ ...node }));
    },
    async rename(id, name) {
      const node = require(id);
      await access.renameDevice(id, name).catch(() => undefined);
      set({ ...node, name });
    },
    async disconnect(id) {
      if (!nodes.delete(id)) return;
      summaries.delete(id);
      await access.revokeDevice(id);
      announce();
    },
    hubState: async () => ({ ...link, os: "darwin arm64", name: "Mac" }),
    async disconnectHub() {
      link = HUB_LINK_NONE;
      announce();
    },
    reportLink(state) {
      link = state;
      announce();
    },
    async register(nodeId, hello) {
      const status = hello.protocolVersion === PROTOCOL_VERSION ? "online" : "update-required";
      return set({ id: nodeId, ...hello, status, lastSeenAt: now() });
    },
    heartbeat(nodeId, threadCount) {
      const node = nodes.get(nodeId);
      if (!node) return;
      nodes.set(nodeId, {
        ...node,
        lastSeenAt: now(),
        threadCount: threadCount ?? node.threadCount,
      });
    },
    markOffline(nodeId) {
      const node = nodes.get(nodeId);
      if (node && node.status !== "offline") set({ ...node, status: "offline", lastSeenAt: now() });
    },
    async readSummary(nodeId) {
      return summaries.get(nodeId);
    },
    async writeSummary(nodeId, summary) {
      require(nodeId);
      summaries.set(nodeId, summary);
    },
  };
  return {
    api,
    setStatus(nodeId, status) {
      set({ ...require(nodeId), status, lastSeenAt: now() });
    },
  };
}
