import { rm } from "node:fs/promises";
import type { ExpelFrame } from "@tau/protocol";
import { EXPEL_LIST_CAP, EXPEL_QUOTA_PER_KEY, EXPEL_TOMBSTONE_EVICT_MS } from "@tau/protocol";
import { type ExpelRecord, verifyExpel } from "@tau/protocol/identity";
import { readFileIfPresent, writeFileAtomic } from "../../home/atomic-write";

export interface StoredExpel {
  readonly frame: ExpelFrame;
  readonly record: ExpelRecord;
}

export type AddResult = "added" | "capacity";

/** Signed expel objects in `<home>/expelled.json` (0600, atomic). Never trusts the file: every entry is verified again. */
export interface ExpelStore {
  load(): Promise<void>;
  get(target: string): StoredExpel | undefined;
  all(): readonly StoredExpel[];
  /** `protectedIds`: linked or directory nodes, never evicted to make room. */
  add(stored: StoredExpel, protectedIds: ReadonlySet<string>): Promise<AddResult>;
  clear(): Promise<void>;
}

const isFrame = (value: unknown): value is ExpelFrame =>
  typeof value === "object" && value !== null && (value as ExpelFrame).type === "expel";

export function createExpelStore(file: string, now: () => number): ExpelStore {
  const entries = new Map<string, StoredExpel>();
  const persist = () =>
    writeFileAtomic(
      file,
      `${JSON.stringify({ version: 1, expels: [...entries.values()].map((entry) => entry.frame) })}\n`,
    );
  const byKey = (by: string) => [...entries.values()].filter((entry) => entry.record.by === by).length;
  const evictable = (protectedIds: ReadonlySet<string>) =>
    [...entries.values()]
      .filter((e) => now() - e.record.time > EXPEL_TOMBSTONE_EVICT_MS && !protectedIds.has(e.record.target))
      .sort((a, b) => a.record.time - b.record.time)[0];
  return {
    async load() {
      const text = await readFileIfPresent(file);
      if (text === undefined) return;
      let parsed: { expels?: unknown[] } | undefined;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      for (const frame of (parsed?.expels ?? []).slice(0, EXPEL_LIST_CAP)) {
        const verdict = isFrame(frame) ? verifyExpel(frame) : undefined;
        if (verdict?.ok)
          entries.set(verdict.record.target, { frame: frame as ExpelFrame, record: verdict.record });
      }
    },
    get: (target) => entries.get(target),
    all: () => [...entries.values()],
    async add(stored, protectedIds) {
      if (byKey(stored.record.by) >= EXPEL_QUOTA_PER_KEY) return "capacity";
      if (entries.size >= EXPEL_LIST_CAP) {
        const victim = evictable(protectedIds);
        if (!victim) return "capacity";
        entries.delete(victim.record.target);
      }
      entries.set(stored.record.target, stored);
      await persist();
      return "added";
    },
    async clear() {
      entries.clear();
      await rm(file, { force: true });
    },
  };
}
