/**
 * SEAM (MVP13 Step 1 foundation; owner C implements). A node's `localStorage` keys are scoped by its id
 * (`nodeKey`, `scopeTarget` in `node-keys.ts`). A migrated peer is first known by its old device id
 * (`Node.identified === false`) and becomes `nodeId` at its first `hello`. The keys then move, LAZILY, once:
 *
 * - Trigger: when `useNodes()` first returns the node with `identified: true` under an id that is not the one
 *   the browser stored for it. The browser keeps `oldId -> nodeId` under one key so a reload does not redo it.
 *   A node without a `nodeId` yet keeps its old keys untouched.
 * - What moves: drafts and attachment targets (`scopeTarget`), seen-baselines, the summary cache
 *   (`nodes/summary-cache.ts`), preferences (`closedProjects`, `projectOpenOverrides`) and the new-thread draft.
 * - Rules: copy then delete the old key; never overwrite a key that already exists at the destination; unrelated
 *   keys and the local node's keys are never touched; a quota error leaves the old key in place.
 * - `/m/<oldId>` URLs resolve through the node list and redirect to `/n/<nodeId>` (`routes/LegacyNodeRedirect.tsx`).
 */
export interface NodeKeyMigration {
  readonly from: string;
  readonly to: string;
}

export interface NodeKeyMigrationResult {
  /** Keys copied to their new name. */
  readonly moved: number;
  /** Keys left alone because the destination already existed. */
  readonly kept: number;
}

/** Owner C: implement against `storage` (tests pass a fake). The foundation stub moves nothing. */
export function migrateNodeKeys(_storage: Storage, _migration: NodeKeyMigration): NodeKeyMigrationResult {
  return { moved: 0, kept: 0 };
}
