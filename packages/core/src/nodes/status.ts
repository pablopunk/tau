import type { NodeStatus } from "@tau/protocol";

export const RECONNECTING_AFTER_MS = 15_000;
export const OFFLINE_AFTER_MS = 45_000;

export interface Liveness {
  readonly lastSeenAt: number;
  readonly protocolMismatch: boolean;
  readonly closed: boolean;
}

export function deriveStatus(entry: Liveness, now: number): NodeStatus {
  const silent = now - entry.lastSeenAt;
  if (silent >= OFFLINE_AFTER_MS) return "offline";
  if (entry.protocolMismatch) return "update-required";
  if (entry.closed) return "offline";
  return silent >= RECONNECTING_AFTER_MS ? "reconnecting" : "online";
}
