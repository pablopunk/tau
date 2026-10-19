/**
 * Per-node `localStorage` keys. The hub's own node keeps today's keys (existing drafts survive); a linked
 * node adds its id (0.1.x wrote `:m:`; `lib/node-key-migration.ts` moves those), so two nodes never share a draft or a preference.
 */
export const nodeKey = (key: string, nodeId?: string): string =>
  nodeId === undefined ? key : `${key}:n:${nodeId}`;

/** A draft or attachment target (a thread id, or `new`) made unique per node. */
export const scopeTarget = (target: string, nodeId?: string): string =>
  nodeId === undefined ? target : `n:${nodeId}:${target}`;
