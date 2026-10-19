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
import { arbitrateDuplicateLink, type LinkFacts } from "../access/duplicate-links";
import type { Peer } from "../peers/peers-store";
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
 * `Core.nodes`: peers from both directions (node devices and `peers.json`) deduped by `nodeId`
 * (`arbitrateDuplicateLink`), standby entries hidden beside a live link, the best link deciding the status,
 * the summary moved to the `nodeId` at the first `hello`, forget/reset-identity.
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
    const report = direction === "dialled" ? reports.get(id) : entry && !entry.closed ? LINKED : undefined;
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
    const anyLinked = links.some((link) => link.state === "linked");
    const status = deriveStatus(
      {
        lastSeenAt: entry.lastSeenAt,
        closed: entry.closed && !anyLinked,
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

  const existingBase = (node: Node) => ({ id: node.id, identified: node.identified, name: node.name });

  /** A standby link is shown only when it is the node's only link: beside a live one it stays hidden. */
  function visibleLinks(links: NodeLink[]): NodeLink[] {
    const live = links.some((link) => link.state === "linked" || link.state === "connecting");
    return live ? links.filter((link) => link.state !== "standby") : links;
  }

  const factsOf = (
    direction: LinkFacts["direction"],
    secretKey: string,
    diallerId: string,
    entry: Entry | undefined,
  ): LinkFacts => ({
    direction,
    diallerId,
    secretKey,
    silentMs: !entry || entry.closed ? Number.POSITIVE_INFINITY : deps.now() - entry.lastSeenAt,
  });

  type Settled = "bound" | "kept-existing";

  /** Binds the verified identity to the device; a second device for one `nodeId` goes through the arbiter. */
  async function bindAccepted(peerId: string, id: string, info: NodePeerInfo): Promise<Settled> {
    const device = (await nodeDevices()).find((entry) => entry.id === peerId || entry.nodeId === peerId);
    if (!device) throw new AppError("not_found", `No node ${peerId}.`);
    if (!info.nodeId || !info.publicKey) return "bound";
    const identity = { nodeId: info.nodeId, publicKey: info.publicKey };
    const bound = await deps.access.bindNodeIdentity(device.id, identity);
    if (bound.ok) return "bound";
    if (bound.reason !== "duplicate-device" || !bound.otherDeviceId)
      throw new AppError("invalid_request", "This node has another identity.");
    const existing = factsOf("accepted", bound.otherDeviceId, id, entries.get(id));
    const incoming = factsOf("accepted", device.id, id, undefined);
    const verdict = arbitrateDuplicateLink(existing, { ...incoming, silentMs: 0 });
    if (verdict.survivor === "existing") {
      if (verdict.revokeLoser) await deps.access.revokeDevice(device.id);
      return "kept-existing";
    }
    if (verdict.revokeLoser) await deps.access.revokeDevice(bound.otherDeviceId);
    const rebound = await deps.access.bindNodeIdentity(device.id, identity);
    if (!rebound.ok) throw new AppError("invalid_request", "This node has another identity.");
    return "bound";
  }

  async function bindDialled(peerId: string, id: string, info: NodePeerInfo): Promise<Settled> {
    const peers = await deps.peers.read();
    const peer = peers.find((entry) => peerIdOf(entry) === peerId);
    if (!peer) throw new AppError("not_found", `No node ${peerId}.`);
    if (peer.nodeId !== undefined && info.nodeId !== undefined && peer.nodeId !== info.nodeId) {
      throw new AppError("invalid_request", "This node has another identity.");
    }
    if (!info.nodeId || !info.publicKey || peer.nodeId !== undefined) return "bound";
    const other = peers.find((entry) => entry !== peer && entry.nodeId === info.nodeId);
    if (other) return arbitrateDialled(peers, peer, other, info);
    await deps.peers.write(
      peers.map((entry) =>
        entry === peer ? { ...peer, nodeId: info.nodeId, publicKey: info.publicKey } : entry,
      ),
    );
    return "bound";
  }

  /** Two `peers.json` entries for one `nodeId` with different secrets: case (b), the new entry goes unless the old link is stale. */
  async function arbitrateDialled(
    peers: Peer[],
    peer: Peer,
    other: Peer,
    info: NodePeerInfo,
  ): Promise<Settled> {
    const selfId = deps.identity().nodeId;
    const existing = factsOf("dialled", other.secret, selfId, entries.get(info.nodeId ?? ""));
    const incoming = factsOf("dialled", peer.secret, selfId, undefined);
    const verdict = arbitrateDuplicateLink(existing, { ...incoming, silentMs: 0 });
    if (verdict.survivor === "existing") {
      if (verdict.revokeLoser) await deps.peers.write(peers.filter((entry) => entry !== peer));
      return "kept-existing";
    }
    const learned = { ...peer, nodeId: info.nodeId, publicKey: info.publicKey };
    const next = peers.filter((entry) => entry !== other).map((entry) => (entry === peer ? learned : entry));
    await deps.peers.write(next);
    return "bound";
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
        if (keys.has(id)) continue;
        keys.add(id);
        const links = [linkOf("accepted", id, entries.get(id))];
        const base = { id, identified: device.nodeId !== undefined, name: device.name };
        nodes.set(id, toNode(base, entries.get(id), device.lastSeenAt, links));
      }
      const dialledSeen = new Set<string>();
      for (const peer of peers) {
        const id = peerIdOf(peer);
        if (dialledSeen.has(id)) continue; // a second entry for one nodeId is a standby secret, hidden
        dialledSeen.add(id);
        keys.add(id);
        const dialled = linkOf("dialled", id, entries.get(id));
        const existing = nodes.get(id);
        if (existing) {
          const links = visibleLinks([...existing.links, dialled]);
          nodes.set(id, toNode(existingBase(existing), entries.get(id), existing.lastSeenAt, links));
        } else {
          const base = { id, identified: peer.nodeId !== undefined, name: peer.name };
          nodes.set(id, toNode(base, entries.get(id), 0, visibleLinks([dialled])));
        }
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
        if ((device.nodeId ?? device.id) === id || device.id === id)
          await deps.access.revokeDevice(device.id);
      const peers = await deps.peers.read();
      if (peers.some((peer) => peerIdOf(peer) === id)) {
        await deps.peers.write(peers.filter((peer) => peerIdOf(peer) !== id));
      }
      announce();
    },
    // `forget` differs from `disconnect` only in what the server sends (no `bye`); the local effect is the same.
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
      const settled =
        direction === "accepted" ? await bindAccepted(peerId, id, info) : await bindDialled(peerId, id, info);
      if (settled === "kept-existing") {
        const kept = await find(id);
        if (!kept) throw new AppError("not_found", `No node ${id}.`);
        return kept;
      }
      if (id !== peerId) {
        await summaries.move(peerId, id);
        entries.delete(peerId);
        reports.delete(peerId);
      }
      entries.set(id, {
        info,
        lastSeenAt: deps.now(),
        closed: false,
        threadCount: entries.get(id)?.threadCount ?? 0,
      });
      if (direction === "dialled") reports.set(id, LINKED);
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
