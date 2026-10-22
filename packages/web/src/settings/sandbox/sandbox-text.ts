import type { SandboxSettings, SandboxSupport } from "@tau/protocol";

/** Which threads a sandbox flag belongs to: its own on/off switch confines that kind of thread. */
export type SandboxScope = keyof SandboxSettings;

export const SANDBOX_SCOPES: { key: SandboxScope; rowId: string; label: string }[] = [
  {
    key: "main",
    rowId: "sandbox-main",
    label: "Main threads",
  },
  {
    key: "worktree",
    rowId: "sandbox-worktree",
    label: "Worktree threads",
  },
  {
    key: "subagent",
    rowId: "sandbox-subagent",
    label: "Subagents",
  },
];

/** Shipped default: subagents and worktree threads are confined, main-checkout threads are not. */
export const SANDBOX_ON_DEFAULT: SandboxSettings = { main: false, worktree: true, subagent: true };
export const SANDBOX_ALL_OFF: SandboxSettings = { main: false, worktree: false, subagent: false };

export const isSandboxOn = (value: SandboxSettings): boolean =>
  value.main || value.worktree || value.subagent;

export const SANDBOX_BLURB =
  "Confined threads may read anywhere but only write inside their own worktree. Off is today's behavior.";
export const SANDBOX_UNENFORCED_BLURB = "Sandboxing is unenforced on this node: threads can write anywhere.";

export const SCOPE_CONFINED = "Confined";
export const SCOPE_STAGED = "Staged";
export const SCOPE_UNENFORCED = "Unenforced";
export const SCOPE_ON_UNENFORCED = "On but unenforced";

/**
 * One scope's status word. Unsupported (or unknown) support is explicit "unenforced",
 * never silent; on plus a verified probe is "confined"; off is "staged".
 */
export function scopeStatus(on: boolean, capability: SandboxSupport | undefined): string {
  if (capability === undefined || capability.mechanism === "none") return SCOPE_UNENFORCED;
  if (!on) return SCOPE_STAGED;
  return capability.enforced ? SCOPE_CONFINED : SCOPE_ON_UNENFORCED;
}
