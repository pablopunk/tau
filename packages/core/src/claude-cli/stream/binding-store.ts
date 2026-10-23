import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import type { Checkpoint, Head } from "./binding";

export interface BindingSnapshot {
  readonly sdkSessionId: string;
  readonly checkpoints: Checkpoint[];
  readonly head: Head | null;
  readonly created: string[];
  readonly model: string;
}

const isCheckpoint = (value: unknown): value is Checkpoint => {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.length === "number" &&
    typeof row.hash === "string" &&
    (row.sdkUuid === null || typeof row.sdkUuid === "string")
  );
};

const isHead = (value: unknown): value is Head => {
  if (value === null) return true;
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.length === "number" && typeof row.hash === "string";
};

const isSnapshot = (value: unknown): value is BindingSnapshot => {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.sdkSessionId === "string" &&
    Array.isArray(row.checkpoints) &&
    row.checkpoints.every(isCheckpoint) &&
    isHead(row.head ?? null) &&
    Array.isArray(row.created) &&
    row.created.every((id): id is string => typeof id === "string") &&
    typeof row.model === "string"
  );
};

/** Load persisted bindings. Missing file, bad JSON or bad rows read as empty, never throw. */
export async function loadBindingSnapshots(file: string): Promise<Record<string, BindingSnapshot>> {
  try {
    const text = await readFile(file, "utf8");
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const snapshots: Record<string, BindingSnapshot> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isSnapshot(value)) snapshots[id] = value;
    }
    return snapshots;
  } catch {
    return {};
  }
}

const tempPathBesides = (file: string): string => `${file}.tmp-${process.pid}-${randomUUID()}`;

/** Readers see the old file or the new one, never a torn one. Nothing is fsynced: a power loss can lose the newest save. */
async function atomicReplaceWithoutFsync(file: string, text: string): Promise<void> {
  const temp = tempPathBesides(file);
  try {
    await writeFile(temp, text, "utf8");
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Replaces the whole file. Rejects on failure: the caller decides how loud a failed save is. */
export async function saveBindingSnapshots(
  file: string,
  snapshots: Record<string, BindingSnapshot>,
): Promise<void> {
  await atomicReplaceWithoutFsync(file, `${JSON.stringify(snapshots)}\n`);
}
