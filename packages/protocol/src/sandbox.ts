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
  /** MCP servers a sandboxed thread may reach; default deny. */
  mcpAllowlist: Type.Optional(Type.Array(Type.String())),
});
export type SandboxSettings = Static<typeof SandboxSettingsSchema>;

export const DEFAULT_SANDBOX_SETTINGS: SandboxSettings = {
  main: false,
  worktree: false,
  subagent: false,
};

/** How Layer 1 confines spawned processes on this node (`none` when unsupported). */
export const SandboxMechanismSchema = Type.Union([
  Type.Literal("seatbelt"),
  Type.Literal("systemd"),
  Type.Literal("bwrap"),
  Type.Literal("none"),
]);
export type SandboxMechanism = Static<typeof SandboxMechanismSchema>;

/**
 * What the support query reports for sandboxing. `enforced` is true only when the probe
 * verified the real path at query time (a denied write outside a scratch root plus a usable
 * Layer-1 mechanism); it never comes from a bare platform check. `tested` says the probe
 * ran its denied-write attempt on this query.
 */
export const SandboxSupportSchema = Type.Object({
  enforced: Type.Boolean(),
  mechanism: SandboxMechanismSchema,
  tested: Type.Boolean(),
  note: Type.Union([Type.String(), Type.Null()]),
});
export type SandboxSupport = Static<typeof SandboxSupportSchema>;
