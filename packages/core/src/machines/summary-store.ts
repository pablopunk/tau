import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { type MachineSummary, MachineSummarySchema } from "@tau/protocol";
import { Value } from "typebox/value";
import { PRIVATE_DIRECTORY_MODE, readFileIfPresent, writeFileAtomic } from "../home/atomic-write";

interface StoredSummary extends MachineSummary {
  stale?: true;
}

/** `<directory>/<id>/summary.json`: titles and times only, mode 0600, written atomically. */
export function createSummaryStore(directory: string) {
  const folder = (id: string) => join(directory, encodeURIComponent(id));
  const file = (id: string) => join(folder(id), "summary.json");
  async function read(id: string): Promise<StoredSummary | undefined> {
    const text = await readFileIfPresent(file(id));
    if (text === undefined) return undefined;
    try {
      const value: unknown = JSON.parse(text);
      return Value.Check(MachineSummarySchema, value) ? (value as StoredSummary) : undefined;
    } catch {
      return undefined;
    }
  }
  async function write(id: string, summary: StoredSummary): Promise<void> {
    await mkdir(folder(id), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    const clean: StoredSummary = {
      savedAt: summary.savedAt,
      projects: summary.projects.map(({ id: projectId, name }) => ({ id: projectId, name })),
      threads: summary.threads.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        title: t.title,
        updatedAt: t.updatedAt,
      })),
      ...(summary.stale ? { stale: true as const } : {}),
    };
    await writeFileAtomic(file(id), JSON.stringify(clean));
  }
  return {
    async read(id: string): Promise<MachineSummary | undefined> {
      const stored = await read(id);
      if (!stored) return undefined;
      const { stale: _stale, ...summary } = stored;
      return summary;
    },
    write,
    async markStale(id: string): Promise<void> {
      const stored = await read(id);
      if (stored && !stored.stale) await write(id, { ...stored, stale: true });
    },
    remove: (id: string) => rm(folder(id), { recursive: true, force: true }),
    removeAll: () => rm(directory, { recursive: true, force: true }),
  };
}
