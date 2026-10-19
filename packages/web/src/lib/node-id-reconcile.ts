import type { Node } from "@tau/protocol";
import { legacyNodeIds, migrateNodeKeys } from "./node-key-migration";

const RECORD_KEY = "tau:node-ids";

interface Remembered {
  /** Unidentified peers seen so far: old device id -> name. */
  pending: Record<string, string>;
  /** Peers already seen with their `nodeId`. */
  identified: string[];
  /** Old id -> `nodeId`, kept so `/m/<id>` links keep working. */
  moved: Record<string, string>;
}

const empty = (): Remembered => ({ pending: {}, identified: [], moved: {} });

function read(storage: Storage): Remembered & { fresh: boolean } {
  try {
    const raw = storage.getItem(RECORD_KEY);
    if (!raw) return { ...empty(), fresh: true };
    const value = JSON.parse(raw) as Partial<Remembered>;
    return {
      pending: value.pending ?? {},
      identified: value.identified ?? [],
      moved: value.moved ?? {},
      fresh: false,
    };
  } catch {
    return { ...empty(), fresh: true };
  }
}

function write(storage: Storage, record: Remembered): void {
  try {
    storage.setItem(RECORD_KEY, JSON.stringify(record));
  } catch {
    // Storage full: the migration just runs again next time.
  }
}

/** A key made under the old marker for an id that is gone from the list: nobody will read it again. */
const orphans = (storage: Storage, nodes: readonly Node[], moved: Record<string, string>): string[] =>
  legacyNodeIds(storage).filter((id) => !nodes.some((node) => node.id === id) && !(id in moved));

function claim(storage: Storage, record: Remembered, node: Node, present: ReadonlySet<string>): void {
  const old = Object.entries(record.pending).find(
    ([id, name]) => !present.has(id) && name === node.name,
  )?.[0];
  if (old === undefined) return;
  migrateNodeKeys(storage, { from: old, to: node.id });
  record.moved[old] = node.id;
  delete record.pending[old];
}

function matchSingleOrphan(
  storage: Storage,
  record: Remembered,
  fresh: Node[],
  nodes: readonly Node[],
): void {
  const unmatched = fresh.filter((node) => !Object.values(record.moved).includes(node.id));
  const lost = orphans(storage, nodes, record.moved);
  const [node] = unmatched;
  const [old] = lost;
  if (unmatched.length !== 1 || lost.length !== 1 || !node || old === undefined) return;
  migrateNodeKeys(storage, { from: old, to: node.id });
  record.moved[old] = node.id;
}

/**
 * Moves each node's keys to its current id, once, and records `old id -> nodeId`.
 *
 * - Every listed node: `:m:<id>` keys become `:n:<id>` (the 0.2.0 marker).
 * - A node that becomes identified (its first `hello`): the keys of the old device id it had before become
 *   `:n:<nodeId>`. The old id is the unidentified entry of the same name that left the list; a node never seen
 *   unidentified is matched only when exactly one orphaned old id and one unknown identified node exist.
 * - A node without a `nodeId` yet keeps its id: only the marker changes.
 */
export function reconcileNodeIds(storage: Storage, nodes: readonly Node[]): Record<string, string> {
  const record = read(storage);
  const present = new Set(nodes.map((node) => node.id));
  for (const node of nodes) migrateNodeKeys(storage, { from: node.id, to: node.id });
  for (const node of nodes) if (!node.identified) record.pending[node.id] = node.name;
  const fresh = nodes.filter((node) => node.identified && !record.identified.includes(node.id));
  for (const node of fresh) claim(storage, record, node, present);
  if (record.fresh) matchSingleOrphan(storage, record, fresh, nodes);
  const identified = nodes.filter((node) => node.identified).map((node) => node.id);
  record.identified = [...new Set([...record.identified, ...identified])];
  write(storage, record);
  return record.moved;
}

/** The id a `/m/<id>` link means now: the recorded move, else the same id (the list may know it already). */
export function resolveLegacyNodeId(storage: Storage, id: string, nodes: readonly Node[]): string {
  const moved = reconcileNodeIds(storage, nodes);
  return moved[id] ?? nodes.find((node) => node.id === id)?.id ?? id;
}
