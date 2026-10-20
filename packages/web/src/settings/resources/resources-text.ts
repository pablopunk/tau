import type { ResourceSettings, ResourceSupport } from "@tau/protocol";

export const NEW_COMMANDS_ONLY = "Applies to new commands only.";
export const NEEDS_UPDATE = "This node needs an update";
export const DEFAULT_SLOTS = 2;
export const DEFAULT_MEMORY_MB = 4096;

export const isControlOn = (value: ResourceSettings): boolean =>
  value.priority !== "off" || value.heavySlots !== null || value.memoryLimitMb !== null;

export const isAnyBoxTicked = (appliesTo: ResourceSettings["appliesTo"]): boolean =>
  appliesTo.main || appliesTo.worktrees || appliesTo.subagents;

export function memorySupportText(support: ResourceSupport): string {
  if (support.memoryEnforcement === "kernel") return "Kernel memory limits";
  if (support.memoryEnforcement === "polled") return "Best effort, checked every 2 s";
  return "Basic";
}

export function supportLines(support: ResourceSupport): string[] {
  const lines = [`Memory: ${memorySupportText(support)}`];
  if (support.sameCgroupOnly) {
    lines.push("Priority only ranks against commands in the same group as tau.");
  }
  if (support.note) lines.push(support.note);
  return lines;
}
