import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { type NodeSummary, NodeSummarySchema } from "@tau/protocol";
import { Value } from "typebox/value";
import { PRIVATE_DIRECTORY_MODE, readFileIfPresent, writeFileAtomic } from "../home/atomic-write";

interface StoredSummary extends NodeSummary {
  stale?: true;
}

/** A summary write can land while a folder is removed (disconnect): ENOTEMPTY is retried, never fatal. */
const REMOVE = { recursive: true, force: true, maxRetries: 5, retryDelay: 40 } as const;

/** `<directory>/<id>/summary.json`: titles and times only, mode 0600, written atomically. */
export function createSummaryStore(directory: string) {
  const folder = (id: string) => join(directory, encodeURIComponent(id));
  const file = (id: string) => join(folder(id), "summary.json");
  async function read(id: string): Promise<StoredSummary | undefined> {
    const text = await readFileIfPresent(file(id));
    if (text === undefined) return undefined;
    try {
      const value: unknown = JSON.parse(text);
      return Value.Check(NodeSummarySchema, value) ? (value as StoredSummary) : undefined;
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
    async read(id: string): Promise<NodeSummary | undefined> {
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
    /** Moves the cache of `from` to `to` (the first `hello` learns the `nodeId`); an existing `to` wins. */
    async move(from: string, to: string): Promise<void> {
      if (from === to) return;
      if ((await read(to)) !== undefined || (await read(from)) === undefined) {
        await rm(folder(from), { recursive: true, force: true });
        return;
      }
      await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
      await rm(folder(to), { recursive: true, force: true });
      await rename(folder(from), folder(to));
    },
    remove: (id: string) => rm(folder(id), REMOVE),
    removeAll: () => rm(directory, REMOVE),
  };
}
