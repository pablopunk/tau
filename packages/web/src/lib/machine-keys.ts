/**
 * Per-machine `localStorage` keys. The hub's own machine keeps today's keys (existing drafts survive); a linked
 * machine adds its id, so two machines never share a draft or a preference.
 */
export const machineKey = (key: string, machineId?: string): string =>
  machineId === undefined ? key : `${key}:m:${machineId}`;

/** A draft or attachment target (a thread id, or `new`) made unique per machine. */
export const scopeTarget = (target: string, machineId?: string): string =>
  machineId === undefined ? target : `m:${machineId}:${target}`;
