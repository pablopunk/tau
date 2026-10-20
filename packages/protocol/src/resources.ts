import { type Static, Type } from "typebox";

export const ResourcePrioritySchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("balanced"),
  Type.Literal("background"),
]);
export type ResourcePriority = Static<typeof ResourcePrioritySchema>;

/** Which threads a command belongs to: its own power level picks the CPU priority. */
export const ResourceScopeSchema = Type.Union([
  Type.Literal("main"),
  Type.Literal("worktree"),
  Type.Literal("subagent"),
]);
export type ResourceScope = Static<typeof ResourceScopeSchema>;

export const ResourceLevelsSchema = Type.Object({
  main: ResourcePrioritySchema,
  worktree: ResourcePrioritySchema,
  subagent: ResourcePrioritySchema,
});
export type ResourceLevels = Static<typeof ResourceLevelsSchema>;

/** Per node. A scope set to `"off"` runs at full speed; any other scope gets its CPU priority plus the memory cap. */
export const ResourceSettingsSchema = Type.Object({
  levels: ResourceLevelsSchema,
});
export type ResourceSettings = Static<typeof ResourceSettingsSchema>;

export const DEFAULT_RESOURCE_SETTINGS: ResourceSettings = {
  levels: { main: "off", worktree: "off", subagent: "off" },
};

export const ResourceMemoryEnforcementSchema = Type.Union([
  Type.Literal("kernel"),
  Type.Literal("polled"),
  Type.Literal("none"),
]);
export type ResourceMemoryEnforcement = Static<typeof ResourceMemoryEnforcementSchema>;

export const ResourceSupportSchema = Type.Object({
  platform: Type.Union([Type.Literal("linux"), Type.Literal("macos"), Type.Literal("other")]),
  /** `kernel`: Linux cgroup scope. `polled`: best-effort sampler. `none`: unsupported. */
  memoryEnforcement: ResourceMemoryEnforcementSchema,
  prioritySupported: Type.Boolean(),
  /** Linux: priority only ranks against processes in the same cgroup as tau. */
  sameCgroupOnly: Type.Boolean(),
  /** Why something is unavailable, when it is. */
  note: Type.Union([Type.String(), Type.Null()]),
});
export type ResourceSupport = Static<typeof ResourceSupportSchema>;

export const ResourceCommandSchema = Type.Object({
  entryId: Type.String(),
  conversationId: Type.String(),
  conversationTitle: Type.String(),
  /** Truncated. */
  command: Type.String(),
  /** Epoch ms: when it started (holder) or began waiting (waiting). */
  since: Type.Number(),
});
export type ResourceCommand = Static<typeof ResourceCommandSchema>;

export const ResourceActivitySchema = Type.Object({
  holders: Type.Array(ResourceCommandSchema),
  waiting: Type.Array(ResourceCommandSchema),
});
export type ResourceActivity = Static<typeof ResourceActivitySchema>;
