import { hostname } from "node:os";
import {
  AppError,
  type Core,
  NODE_CAPABILITIES,
  type Node,
  type NodeLink,
  type NodeLinkReport,
  type NodePeerInfo,
} from "@tau/protocol";
import { peerIdOf } from "./peer-id";
import type { NodesDeps } from "./ports";
import { deriveStatus } from "./status";
import { createSummaryStore } from "./summary-store";

interface Entry {
  info: NodePeerInfo;
  lastSeenAt: number;
  closed: boolean;
  threadCount: number;
}

export type NodesService = Core["nodes"] & {
  /** Forgets every live entry and every cached summary (remote disable or recreate clears the devices too). */
  reset(): Promise<void>;
};

const LINKED: NodeLinkReport = { state: "linked", message: null, since: null };

/**
 * `Core.nodes`. Step 1 foundation: peers from both directions (node devices and `peers.json`), identity,
 * per-peer link reports, forget and reset-identity. Owner A fills (marked TODO(A)): dedupe of two links to
 * one `nodeId` with `duplicate-links.ts`, standby entries, moving a summary from the old id to the `nodeId`,
 * and the exact status mix of two links.
 */
export function createNodes(deps: NodesDeps): NodesService {
  const entries = new Map<string, Entry>();
  const reports = new Map<string, NodeLinkReport>();
  const summaries = createSummaryStore(deps.directory);
  const announce = () => deps.changes.emit({ resource: "nodes" });

  async function nodeDevices() {
    return (await deps.access.listDevices("")).filter((device) => device.kind === "node");
  }

  function linkOf(direction: NodeLink["direction"], id: string, entry: Entry | undefined): NodeLink {
    const report =
      reports.get(id) ?? (direction === "accepted" && entry && !entry.closed ? LINKED : undefined);
    return {
      direction,
      state: report?.state ?? "unreachable",
      message: report?.message ?? null,
      since: report?.since ?? null,
    };
  }

  function toNode(
    base: Pick<Node, "id" | "identified" | "name">,
    entry: Entry | undefined,
    seenAt: number,
    links: NodeLink[],
  ): Node {
    if (!entry) {
      // A dialled peer is known by the dialler's per-peer reports until its first `hello` registers it.
      const dialled = links.find((link) => link.direction === "dialled");
      const status =
        dialled?.state === "linked"
          ? "online"
          : dialled?.state === "update-required"
            ? "update-required"
            : "offline";
      return {
        ...base,
        os: "",
        tauVersion: "",
        protocolVersion: "",
        status,
        lastSeenAt: seenAt,
        threadCount: 0,
        links,
      };
    }
    const status = deriveStatus(
      {
        lastSeenAt: entry.lastSeenAt,
        closed: entry.closed,
        protocolMismatch: entry.info.protocolVersion !== deps.protocolVersion,
      },
      deps.now(),
    );
    return {
      ...base,
      os: entry.info.os,
      tauVersion: entry.info.tauVersion,
      protocolVersion: entry.info.protocolVersion,
      status,
      lastSeenAt: entry.lastSeenAt,
      threadCount: entry.threadCount,
      links,
    };
  }

  async function find(id: string): Promise<Node | undefined> {
    return (await api.list()).find((node) => node.id === id);
  }

  const api: NodesService = {
    async self() {
      const identity = deps.identity();
      return {
        nodeId: identity.nodeId,
        publicKey: identity.publicKey,
        name: hostname().replace(/\.local$/i, ""),
        os: `${process.platform} ${process.arch}`,
        tauVersion: deps.tauVersion,
        protocolVersion: deps.protocolVersion,
        linkProtocol: deps.linkProtocol,
        capabilities: [...NODE_CAPABILITIES],
      };
    },
    sign: async (payload) => deps.identity().sign(payload),
    async list() {
      const devices = await nodeDevices();
      const peers = await deps.peers.read();
      const nodes = new Map<string, Node>();
      const keys = new Set<string>();
      for (const device of devices) {
        const id = device.nodeId ?? device.id;
        keys.add(id);
        const links = [linkOf("accepted", id, entries.get(id))];
        nodes.set(
          id,
          toNode(
            { id, identified: device.nodeId !== undefined, name: device.name },
            entries.get(id),
            device.lastSeenAt,
            links,
          ),
        );
      }
      for (const peer of peers) {
        const id = peerIdOf(peer);
        keys.add(id);
        const dialled = linkOf("dialled", id, entries.get(id));
        const existing = nodes.get(id);
        // TODO(A): dedupe by nodeId with arbitrateDuplicateLink, hide standby entries, mix the status of two links.
        if (existing) nodes.set(id, { ...existing, links: [...existing.links, dialled] });
        else
          nodes.set(
            id,
            toNode({ id, identified: peer.nodeId !== undefined, name: peer.name }, entries.get(id), 0, [
              dialled,
            ]),
          );
      }
      for (const id of entries.keys()) if (!keys.has(id)) entries.delete(id);
      for (const id of reports.keys()) if (!keys.has(id)) reports.delete(id);
      return [...nodes.values()];
    },
    async rename(id, name) {
      if (!(await find(id))) throw new AppError("not_found", `No node ${id}.`);
      for (const device of await nodeDevices())
        if ((device.nodeId ?? device.id) === id) await deps.access.renameDevice(device.id, name);
      const peers = await deps.peers.read();
      if (peers.some((peer) => peerIdOf(peer) === id)) {
        await deps.peers.write(peers.map((peer) => (peerIdOf(peer) === id ? { ...peer, name } : peer)));
      }
      announce();
    },
    async disconnect(id) {
      entries.delete(id);
      reports.delete(id);
      await summaries.remove(id);
      for (const device of await nodeDevices())
        if ((device.nodeId ?? device.id) === id) await deps.access.revokeDevice(device.id);
      const peers = await deps.peers.read();
      if (peers.some((peer) => peerIdOf(peer) === id)) {
        await deps.peers.write(peers.filter((peer) => peerIdOf(peer) !== id));
      }
      announce();
    },
    // TODO(A): `forget` differs from `disconnect` only in what the server sends (no `bye`); core's local effect is the same.
    forget: (id) => api.disconnect(id),
    async resetIdentity() {
      await deps.resetIdentity();
      await deps.peers.write([]);
      for (const device of await nodeDevices()) await deps.access.revokeDevice(device.id);
      await api.reset();
    },
    reportLink(peerId, state) {
      reports.set(peerId, state);
      announce();
    },
    async register(peerId, info, direction) {
      const id = info.nodeId ?? peerId;
      if (direction === "accepted") {
        const device = (await nodeDevices()).find((entry) => entry.id === peerId || entry.nodeId === peerId);
        if (!device) throw new AppError("not_found", `No node ${peerId}.`);
        if (info.nodeId && info.publicKey) {
          const bound = await deps.access.bindNodeIdentity(device.id, {
            nodeId: info.nodeId,
            publicKey: info.publicKey,
          });
          if (!bound.ok && bound.reason !== "duplicate-device")
            throw new AppError("invalid_request", "This node has another identity.");
        }
      } else {
        const peers = await deps.peers.read();
        const peer = peers.find((entry) => peerIdOf(entry) === peerId);
        if (!peer) throw new AppError("not_found", `No node ${peerId}.`);
        if (peer.nodeId !== undefined && info.nodeId !== undefined && peer.nodeId !== info.nodeId) {
          throw new AppError("invalid_request", "This node has another identity.");
        }
        if (info.nodeId && info.publicKey && peer.nodeId === undefined) {
          await deps.peers.write(
            peers.map((entry) =>
              entry === peer ? { ...peer, nodeId: info.nodeId, publicKey: info.publicKey } : entry,
            ),
          );
        }
      }
      // TODO(A): when `id` differs from `peerId`, move `nodes/<peerId>/summary.json` to `nodes/<nodeId>/`.
      entries.set(id, {
        info,
        lastSeenAt: deps.now(),
        closed: false,
        threadCount: entries.get(id)?.threadCount ?? 0,
      });
      reports.set(id, LINKED);
      announce();
      const node = await find(id);
      if (!node) throw new AppError("not_found", `No node ${id}.`);
      return node;
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
      const count = threadCount ?? entry.threadCount;
      const changed = entry.threadCount !== count || before !== "online";
      entry.threadCount = count;
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
      if (!entry || entry.closed || entry.info.protocolVersion !== deps.protocolVersion) return;
      if (
        deriveStatus({ lastSeenAt: entry.lastSeenAt, closed: false, protocolMismatch: false }, deps.now()) !==
        "online"
      )
        return;
      await summaries.write(nodeId, summary);
    },
    async reset() {
      entries.clear();
      reports.clear();
      await summaries.removeAll();
      announce();
    },
  };
  return api;
}
