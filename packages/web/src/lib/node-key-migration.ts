/**
 * A node's `localStorage` keys are scoped by its id (`nodeKey`, `scopeTarget` in `node-keys.ts`). 0.1.x wrote
 * `…:m:<id>` and `m:<id>:<target>`; 0.2.0 writes `…:n:<id>` and `n:<id>:<target>`. A migrated peer is first known by
 * its old device id (`Node.identified === false`) and becomes `nodeId` at its first `hello`. The keys then move,
 * LAZILY, once (see `node-id-reconcile.ts` for the trigger):
 *
 * - What moves: drafts and attachment targets (`scopeTarget`), seen-baselines, last-seen times, the summary cache,
 *   preferences (`closedProjects`, `projectOpenOverrides`) and the new-thread draft: every key made by `nodeKey`
 *   or `scopeTarget`.
 * - Rules: copy then delete the old key; never overwrite a key that already exists at the destination (the old
 *   one stays); unrelated keys and the local node's keys (no marker) are never touched; a quota error leaves the
 *   old key in place.
 */
export interface NodeKeyMigration {
  readonly from: string;
  readonly to: string;
}

export interface NodeKeyMigrationResult {
  /** Keys copied to their new name. */
  readonly moved: number;
  /** Keys left alone because the destination already existed or could not be written. */
  readonly kept: number;
}

const MARKERS = ["m", "n"] as const;

/** `base:m:<from>` and `base:n:<from>` (`nodeKey`), `…m:<from>:<target>` and `…n:<from>:<target>` (`scopeTarget`). */
export function renamedKey(key: string, { from, to }: NodeKeyMigration): string | null {
  for (const marker of MARKERS) {
    const suffix = `:${marker}:${from}`;
    if (key.endsWith(suffix)) return `${key.slice(0, -suffix.length)}:n:${to}`;
    const inner = `:${marker}:${from}:`;
    const at = key.indexOf(inner);
    if (at >= 0) return `${key.slice(0, at)}:n:${to}:${key.slice(at + inner.length)}`;
  }
  return null;
}

function keysOf(storage: Storage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null) keys.push(key);
  }
  return keys;
}

function moveKey(storage: Storage, from: string, to: string): "moved" | "kept" {
  if (from === to) return "kept";
  const value = storage.getItem(from);
  if (value === null || storage.getItem(to) !== null) return "kept";
  try {
    storage.setItem(to, value);
  } catch {
    return "kept";
  }
  storage.removeItem(from);
  return "moved";
}

export function migrateNodeKeys(storage: Storage, migration: NodeKeyMigration): NodeKeyMigrationResult {
  let moved = 0;
  let kept = 0;
  for (const key of keysOf(storage)) {
    const next = renamedKey(key, migration);
    if (next === null || next === key) continue;
    if (moveKey(storage, key, next) === "moved") moved += 1;
    else kept += 1;
  }
  return { moved, kept };
}

/** Ids that have keys under the 0.1.x `:m:` marker. */
export function legacyNodeIds(storage: Storage): string[] {
  const ids = new Set<string>();
  for (const key of keysOf(storage)) {
    const match = /:m:([^:]+)(?::|$)/.exec(key);
    if (match?.[1]) ids.add(match[1]);
  }
  return [...ids];
}
