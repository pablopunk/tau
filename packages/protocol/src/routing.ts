import { GROUP_NODE_CAP, ROUTE_TTL_START } from "./node-link-routing";

/** What one origin's latest accepted announce says: who it lists as neighbours. `live` is false once it expired (a ghost). */
export interface DirectoryRecord {
  readonly origin: string;
  readonly neighbours: readonly string[];
  readonly live: boolean;
}

export interface RouteGraphInput {
  readonly self: string;
  /** Peers this node has a live, synced link to right now (its own edges, known first-hand). */
  readonly links: readonly string[];
  readonly records: readonly DirectoryRecord[];
  /** Tombstoned ids never route and never count. */
  readonly tombstoned?: ReadonlySet<string>;
  /** Default `GROUP_NODE_CAP`, counting this node. */
  readonly cap?: number;
}

export interface Route {
  readonly dest: string;
  /** The direct peer to hand the frame to. */
  readonly nextHop: string;
  readonly hops: number;
}

export interface RouteTable {
  readonly routes: ReadonlyMap<string, Route>;
  /** Live, mutually connected origins beyond the cap: ignored and shown as a warning. */
  readonly ignored: readonly string[];
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * An edge A-B exists only when BOTH list each other. This node's own side is `links` (first-hand); a
 * remote node's side is its live record. Expired records (ghosts) and tombstoned ids have no edges.
 */
export function mutualEdges(input: RouteGraphInput): Map<string, string[]> {
  const dead = input.tombstoned ?? new Set<string>();
  const lists = new Map<string, ReadonlySet<string>>();
  lists.set(input.self, new Set(input.links.filter((id) => !dead.has(id))));
  for (const record of input.records) {
    if (record.live && record.origin !== input.self && !dead.has(record.origin)) {
      lists.set(record.origin, new Set(record.neighbours));
    }
  }
  const edges = new Map<string, string[]>();
  for (const [node, listed] of lists) {
    const mutual = [...listed].filter((other) => other !== node && lists.get(other)?.has(node));
    edges.set(node, mutual.sort(byId));
  }
  return edges;
}

/**
 * Shortest hop count over mutual live edges; a tie is broken by the LOWEST `nodeId` of the next hop. Only
 * origins connected to this node by a mutual path are counted toward the cap (a free keypair that nobody
 * links to cannot fill it); beyond the cap, the farthest then highest ids are ignored.
 */
export function computeRoutes(input: RouteGraphInput): RouteTable {
  const edges = mutualEdges(input);
  const cap = input.cap ?? GROUP_NODE_CAP;
  const depth = new Map<string, number>([[input.self, 0]]);
  const firstHop = new Map<string, string>();
  let frontier = [input.self];
  for (let level = 1; frontier.length > 0; level++) {
    const next = new Map<string, string>();
    for (const node of frontier) {
      for (const peer of edges.get(node) ?? []) {
        if (depth.has(peer)) continue;
        const via = node === input.self ? peer : (firstHop.get(node) as string);
        const best = next.get(peer);
        if (best === undefined || via < best) next.set(peer, via);
      }
    }
    for (const [peer, via] of next) {
      depth.set(peer, level);
      firstHop.set(peer, via);
    }
    frontier = [...next.keys()].sort(byId);
  }
  const reachable = [...depth.keys()]
    .filter((id) => id !== input.self)
    .sort((a, b) => (depth.get(a) as number) - (depth.get(b) as number) || byId(a, b));
  const admitted = reachable.slice(0, Math.max(0, cap - 1));
  const routes = new Map<string, Route>();
  for (const dest of admitted) {
    routes.set(dest, { dest, nextHop: firstHop.get(dest) as string, hops: depth.get(dest) as number });
  }
  return { routes, ignored: reachable.slice(admitted.length) };
}

/** A `ttl` from the wire, forced to an integer in `[0, ROUTE_TTL_START]` (a bad value is 0: the frame dies). */
export function clampTtl(ttl: unknown): number {
  if (typeof ttl !== "number" || !Number.isFinite(ttl)) return 0;
  return Math.min(ROUTE_TTL_START, Math.max(0, Math.trunc(ttl)));
}

/** The `ttl` a relay forwards; `undefined` when the frame must die here (ttl 0). */
export function forwardTtl(ttl: unknown): number | undefined {
  const clamped = clampTtl(ttl);
  return clamped <= 0 ? undefined : clamped - 1;
}

/** A node refuses a routed frame whose `trail` already holds its own id, or whose `ttl` is spent. */
export function loopsBack(
  self: string,
  frame: { readonly trail?: readonly string[]; readonly ttl?: unknown },
): boolean {
  return (frame.trail ?? []).includes(self) || clampTtl(frame.ttl) <= 0;
}
