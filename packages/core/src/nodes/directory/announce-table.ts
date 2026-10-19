import type { DirectoryRecord } from "@tau/protocol";
import { ANNOUNCE_EXPIRY_MS } from "@tau/protocol";
import { type AnnounceRecord, isNewerSequence } from "@tau/protocol/identity";

interface Entry {
  readonly record: AnnounceRecord;
  readonly receivedAt: number;
}

/** The latest accepted announce per origin; one past `ANNOUNCE_EXPIRY_MS` is a ghost (kept for display, never routed). */
export interface AnnounceTable {
  get(origin: string): AnnounceRecord | undefined;
  isStale(record: AnnounceRecord): boolean;
  set(record: AnnounceRecord): () => void;
  remove(origin: string): void;
  live(origin: string): boolean;
  receivedAt(origin: string): number | undefined;
  records(): DirectoryRecord[];
  all(): AnnounceRecord[];
  /** True when something just expired (the topology changed). */
  sweep(): boolean;
  clear(): void;
}

export function createAnnounceTable(now: () => number): AnnounceTable {
  const entries = new Map<string, Entry>();
  const expired = new Set<string>();
  const isLive = (entry: Entry) => now() - entry.receivedAt < ANNOUNCE_EXPIRY_MS;
  return {
    get: (origin) => entries.get(origin)?.record,
    isStale(record) {
      const current = entries.get(record.origin)?.record;
      return !isNewerSequence(record, current);
    },
    set(record) {
      const previous = entries.get(record.origin);
      entries.set(record.origin, { record, receivedAt: now() });
      expired.delete(record.origin);
      return () => (previous ? entries.set(record.origin, previous) : entries.delete(record.origin));
    },
    remove: (origin) => void entries.delete(origin),
    live: (origin) => {
      const entry = entries.get(origin);
      return entry !== undefined && isLive(entry);
    },
    receivedAt: (origin) => entries.get(origin)?.receivedAt,
    records: () =>
      [...entries.values()].map((entry) => ({
        origin: entry.record.origin,
        neighbours: entry.record.neighbours,
        live: isLive(entry),
      })),
    all: () => [...entries.values()].map((entry) => entry.record),
    sweep() {
      let changed = false;
      for (const [origin, entry] of entries) {
        if (!isLive(entry) && !expired.has(origin)) {
          expired.add(origin);
          changed = true;
        }
      }
      return changed;
    },
    clear() {
      entries.clear();
      expired.clear();
    },
  };
}
