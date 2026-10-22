import { readFile, writeFile } from "node:fs/promises";
import type { Checkpoint, Head } from "./binding";

export interface BindingSnapshot {
  readonly sdkSessionId: string;
  readonly checkpoints: Checkpoint[];
  readonly head: Head | null;
  readonly created: string[];
  readonly model: string;
}

type SnapshotFile = Record<string, BindingSnapshot>;

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

/** Best-effort save: a failing write must never fail a turn. */
export async function saveBindingSnapshots(
  file: string,
  snapshots: Record<string, BindingSnapshot>,
): Promise<void> {
  try {
    await writeFile(file, `${JSON.stringify(snapshots)}\n`, "utf8");
  } catch {
    // ignore: bindings still work in memory; the next save retries.
  }
}
