/**
 * Per-node `localStorage` keys. The hub's own node keeps today's keys (existing drafts survive); a linked
 * node adds its id, so two nodes never share a draft or a preference.
 */
export const nodeKey = (key: string, nodeId?: string): string =>
  nodeId === undefined ? key : `${key}:m:${nodeId}`;

/** A draft or attachment target (a thread id, or `new`) made unique per node. */
export const scopeTarget = (target: string, nodeId?: string): string =>
  nodeId === undefined ? target : `m:${nodeId}:${target}`;
