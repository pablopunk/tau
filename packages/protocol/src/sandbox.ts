import { type Static, Type } from "typebox";

/**
 * Per-node sandbox switch (phase 1: persisted, never enforced). Each scope confines
 * spawned processes and in-process writes to the thread's own worktree when true.
 * Staging gate: everything defaults to false until phase 2 removes the gate.
 */
export const SandboxSettingsSchema = Type.Object({
  main: Type.Boolean(),
  worktree: Type.Boolean(),
  subagent: Type.Boolean(),
});
export type SandboxSettings = Static<typeof SandboxSettingsSchema>;

export const DEFAULT_SANDBOX_SETTINGS: SandboxSettings = {
  main: false,
  worktree: false,
  subagent: false,
};
