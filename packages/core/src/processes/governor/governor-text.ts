import type { StopReason } from "../process-types";

export const waitingForSlotText = (busy: number, limit: number) =>
  `Waiting for a free slot (${busy} of ${limit} busy)...\n`;

export const probeFailedText = (reason: string) =>
  `Resource limits unavailable: ${reason}. Fix or turn them off in Settings → Resources.`;

export const notStartedText = "not started: tau restarted\n";

export const memoryStopText = (limitMb: number | null) =>
  limitMb === null ? "Stopped: memory limit exceeded" : `Stopped: memory limit ${limitMb} MB exceeded`;

export function stopMessage(reason: StopReason, memoryLimitMb: number | null, timeoutText: string): string {
  if (reason === "timeout") return timeoutText;
  if (reason === "resources") return "Stopped from Resources settings";
  if (reason === "memory") return memoryStopText(memoryLimitMb);
  return "Command aborted";
}

export const CGROUP_NOTE =
  "Priority only ranks against processes in the same cgroup as tau (a terminal session, not a systemd service).";
export const UNSUPPORTED_NOTE = "Resource control is not available on this platform.";
export const POLLED_NOTE = "Best effort, checked every 2 s.";
