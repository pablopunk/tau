import type { SandboxSupport } from "@tau/protocol";

/**
 * One sandbox preset: which threads are confined to their own worktree.
 * Subagents run inside worktrees, so "worktrees" confines them too.
 */
export type SandboxPreset = "no" | "worktrees" | "all";

export const SANDBOX_PRESETS: readonly SandboxPreset[] = ["no", "worktrees", "all"] as const;

export const PRESET_SETTINGS: Record<SandboxPreset, { main: boolean; worktree: boolean; subagent: boolean }> =
  {
    no: { main: false, worktree: false, subagent: false },
    worktrees: { main: false, worktree: true, subagent: true },
    all: { main: true, worktree: true, subagent: true },
  };

/** Legacy or hand-edited combos collapse to the closest preset: main wins, else any worktree scope. */
export function presetOf(value: { main: boolean; worktree: boolean; subagent: boolean }): SandboxPreset {
  if (value.main) return "all";
  if (value.worktree || value.subagent) return "worktrees";
  return "no";
}

export const SANDBOX_BLURB =
  "Confined threads may read anywhere but only write inside their own worktree. Off is today's behavior.";
export const SANDBOX_UNENFORCED_BLURB = "Sandboxing is unenforced on this node: threads can write anywhere.";

export const SCOPE_CONFINED = "Confined";
export const SCOPE_STAGED = "Staged";
export const SCOPE_UNENFORCED = "Unenforced";
export const SCOPE_ON_UNENFORCED = "On but unenforced";

/**
 * The preset's status word. Unsupported (or unknown) support is explicit "unenforced",
 * never silent; on plus a verified probe is "confined"; off is "staged".
 */
export function scopeStatus(on: boolean, capability: SandboxSupport | undefined): string {
  if (capability === undefined || capability.mechanism === "none") return SCOPE_UNENFORCED;
  if (!on) return SCOPE_STAGED;
  return capability.enforced ? SCOPE_CONFINED : SCOPE_ON_UNENFORCED;
}
