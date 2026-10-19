import type { DirectoryNode, Node, Route } from "@tau/protocol";
import type { AnnounceRecord } from "@tau/protocol/identity";

export interface ViewInput {
  readonly peers: readonly Node[];
  readonly records: readonly AnnounceRecord[];
  readonly live: (origin: string) => boolean;
  readonly receivedAt: (origin: string) => number | undefined;
  readonly routes: ReadonlyMap<string, Route>;
  readonly tombstoned: (id: string) => boolean;
  readonly selfId: string;
  readonly synced: (id: string) => boolean;
  readonly linked: (id: string) => boolean;
  readonly skew: (id: string) => number | undefined;
}

/** Peers (direct) first, then nodes known only from announces (routed, or ghosts when they stopped announcing). */
export function buildDirectory(input: ViewInput): DirectoryNode[] {
  const names = new Map<string, string>();
  for (const peer of input.peers) names.set(peer.id, peer.name);
  for (const record of input.records) if (!names.has(record.origin)) names.set(record.origin, record.name);
  const nameOf = (id: string | null) => (id === null ? null : (names.get(id) ?? id));
  const extra = (id: string) => ({
    skewMs: input.skew(id) ?? null,
    unsynced: input.linked(id) && !input.synced(id),
  });
  const peerNodes = input.peers
    .filter((peer) => !input.tombstoned(peer.id) && peer.id !== input.selfId)
    .map((peer): DirectoryNode => {
      const route = input.routes.get(peer.id);
      const routed = peer.links.length === 0 && route !== undefined && route.hops > 1;
      return {
        ...peer,
        direct: !routed,
        hops: routed ? route.hops : 1,
        nextHop: routed ? route.nextHop : peer.id,
        via: routed ? nameOf(route.nextHop) : null,
        ghost: false,
        ...extra(peer.id),
      };
    });
  const known = new Set(peerNodes.map((node) => node.id));
  const announced = input.records
    .filter((r) => !known.has(r.origin) && !input.tombstoned(r.origin) && r.origin !== input.selfId)
    .map((record): DirectoryNode => {
      const route = input.routes.get(record.origin);
      const ghost = !input.live(record.origin);
      return {
        id: record.origin,
        identified: true,
        name: record.name,
        os: record.os,
        tauVersion: record.tauVersion,
        protocolVersion: record.protocolVersion,
        status: ghost || !route ? "offline" : "online",
        lastSeenAt: input.receivedAt(record.origin) ?? 0,
        threadCount: 0,
        links: [],
        direct: false,
        hops: route?.hops ?? 2,
        nextHop: route?.nextHop ?? null,
        via: nameOf(route?.nextHop ?? null),
        ghost,
        ...extra(record.origin),
      };
    });
  return [...peerNodes, ...announced];
}
