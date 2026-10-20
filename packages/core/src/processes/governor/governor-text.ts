import type { ResourcePriority, ResourceScope } from "@tau/protocol";
import type { StopReason } from "../process-types";

export const probingResourcesText = () => `Checking resource limits before spawn...\n`;

export const probeFailedText = (reason: string) =>
  `Resource limits unavailable: ${reason}. Fix or turn them off in Settings → Agent.`;

/** The setting row's name, so a stopped command can point at it. */
export const scopeDisplayName = (scope: ResourceScope): string =>
  scope === "main" ? "Main threads" : scope === "worktree" ? "Worktree threads" : "Subagents";

export const memoryStopText = (
  limitMb: number | null,
  scope?: ResourceScope,
  level?: ResourcePriority,
): string => {
  const base =
    limitMb === null ? "Stopped: memory limit exceeded" : `Stopped: memory limit ${limitMb} MB exceeded`;
  if (!scope || !level || level === "off") return base;
  const levelName = level.charAt(0).toUpperCase() + level.slice(1);
  return (
    `${base} (resource control is on: ${scopeDisplayName(scope)} run at ${levelName}). ` +
    `To allow more memory, set ${scopeDisplayName(scope)} to Off in Settings → Agent, ` +
    `or split the work into smaller steps.`
  );
};

export function stopMessage(
  reason: StopReason,
  memoryLimitMb: number | null,
  timeoutText: string,
  scope?: ResourceScope,
  level?: ResourcePriority,
): string {
  if (reason === "timeout") {
    if (scope && level && level !== "off") {
      const levelName = level.charAt(0).toUpperCase() + level.slice(1);
      return `${timeoutText} (${scopeDisplayName(scope)} run at ${levelName}, which slows commands down)`;
    }
    return timeoutText;
  }
  if (reason === "resources") return "Stopped from Resources settings";
  if (reason === "memory") return memoryStopText(memoryLimitMb, scope, level);
  return "Command aborted";
}

export const CGROUP_NOTE =
  "Priority only ranks against processes in the same cgroup as tau (a terminal session, not a systemd service).";
export const UNSUPPORTED_NOTE = "Resource control is not available on this platform.";
export const POLLED_NOTE = "Best effort, checked every 2 s.";
