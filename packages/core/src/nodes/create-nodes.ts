import { hostname } from "node:os";
import { AppError, type Core, HUB_LINK_NONE, type HubLink, type Node, type NodeHello } from "@tau/protocol";
import type { NodesDeps } from "./ports";
import { deriveStatus } from "./status";
import { createSummaryStore } from "./summary-store";

interface Entry {
  hello: NodeHello;
  lastSeenAt: number;
  closed: boolean;
}

export type NodesService = Core["nodes"] & {
  /** Forgets every node and its summary (remote disable or recreate clears the devices too). */
  reset(): Promise<void>;
};

/** `Core.nodes`: an in-memory registry fed by the link, over node devices of the access store. */
export function createNodes(deps: NodesDeps): NodesService {
  let link: HubLink = HUB_LINK_NONE;
  const entries = new Map<string, Entry>();
  const summaries = createSummaryStore(deps.directory);
  const announce = () => deps.changes.emit({ resource: "nodes" });

  async function nodeDevices() {
    return (await deps.access.listDevices("")).filter((device) => device.kind === "machine");
  }
  function toNode(id: string, name: string, entry: Entry | undefined, deviceSeenAt: number): Node {
    if (!entry) {
      return {
        id,
        name,
        os: "",
        tauVersion: "",
        protocolVersion: "",
        status: "offline",
        lastSeenAt: deviceSeenAt,
        threadCount: 0,
      };
    }
    const { hello } = entry;
    const status = deriveStatus(
      {
        lastSeenAt: entry.lastSeenAt,
        closed: entry.closed,
        protocolMismatch: hello.protocolVersion !== deps.protocolVersion,
      },
      deps.now(),
    );
    return {
      id,
      name,
      os: hello.os,
      tauVersion: hello.tauVersion,
      protocolVersion: hello.protocolVersion,
      status,
      lastSeenAt: entry.lastSeenAt,
      threadCount: hello.threadCount,
      ...(link.state !== "none" && link.hubName ? { linkedTo: link.hubName } : {}),
    };
  }
  async function find(id: string): Promise<Node | undefined> {
    return (await api.list()).find((node) => node.id === id);
  }
  const api: NodesService = {
    async list() {
      const devices = await nodeDevices();
      const ids = new Set(devices.map((device) => device.id));
      for (const id of entries.keys()) if (!ids.has(id)) entries.delete(id);
      return devices.map((d) => toNode(d.id, d.name, entries.get(d.id), d.lastSeenAt));
    },
    async rename(id, name) {
      if (!(await find(id))) throw new AppError("not_found", `No node ${id}.`);
      await deps.access.renameDevice(id, name);
      announce();
    },
    async disconnect(id) {
      entries.delete(id);
      await summaries.remove(id);
      await deps.access.revokeDevice(id);
      announce();
    },
    hubState: async () => ({
      ...link,
      os: `${process.platform} ${process.arch}`,
      name: hostname().replace(/\.local$/i, ""),
    }),
    async disconnectHub() {
      await deps.forgetHub?.();
      link = HUB_LINK_NONE;
      announce();
    },
    reportLink(state) {
      link = state;
      announce();
    },
    async register(nodeId, hello) {
      const device = (await nodeDevices()).find((entry) => entry.id === nodeId);
      if (!device) throw new AppError("not_found", `No node ${nodeId}.`);
      entries.set(nodeId, { hello, lastSeenAt: deps.now(), closed: false });
      announce();
      return toNode(nodeId, device.name, entries.get(nodeId), device.lastSeenAt);
    },
    heartbeat(nodeId, threadCount) {
      const entry = entries.get(nodeId);
      if (!entry) return;
      const before = deriveStatus(
        { lastSeenAt: entry.lastSeenAt, closed: entry.closed, protocolMismatch: false },
        deps.now(),
      );
      entry.lastSeenAt = deps.now();
      entry.closed = false;
      const count = threadCount ?? entry.hello.threadCount;
      const changed = entry.hello.threadCount !== count || before !== "online";
      entry.hello = { ...entry.hello, threadCount: count };
      if (changed) announce();
    },
    markOffline(nodeId) {
      const entry = entries.get(nodeId);
      if (!entry) return;
      entry.closed = true;
      entry.lastSeenAt = deps.now();
      void summaries.markStale(nodeId).catch(() => undefined);
      announce();
    },
    readSummary: (nodeId) => summaries.read(nodeId),
    async writeSummary(nodeId, summary) {
      const entry = entries.get(nodeId);
      if (!entry || entry.closed || entry.hello.protocolVersion !== deps.protocolVersion) return;
      if (
        deriveStatus({ lastSeenAt: entry.lastSeenAt, closed: false, protocolMismatch: false }, deps.now()) !==
        "online"
      )
        return;
      await summaries.write(nodeId, summary);
    },
    async reset() {
      entries.clear();
      await summaries.removeAll();
      announce();
    },
  };
  return api;
}
