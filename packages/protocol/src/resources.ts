import { type Static, Type } from "typebox";

export const ResourcePrioritySchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("balanced"),
  Type.Literal("background"),
]);
export type ResourcePriority = Static<typeof ResourcePrioritySchema>;

export const ResourceAppliesToSchema = Type.Object({
  main: Type.Boolean(),
  worktrees: Type.Boolean(),
  subagents: Type.Boolean(),
});
export type ResourceAppliesTo = Static<typeof ResourceAppliesToSchema>;

export const HEAVY_SLOTS_MIN = 1;
export const HEAVY_SLOTS_MAX = 64;
export const MEMORY_LIMIT_MIN_MB = 64;

/** Per node. "Off" is `priority: "off"`, `heavySlots: null` and `memoryLimitMb: null`; each control works alone. */
export const ResourceSettingsSchema = Type.Object({
  priority: ResourcePrioritySchema,
  /** `null` = unlimited. */
  heavySlots: Type.Union([Type.Integer({ minimum: HEAVY_SLOTS_MIN, maximum: HEAVY_SLOTS_MAX }), Type.Null()]),
  /** `null` = no limit. Per command process tree. */
  memoryLimitMb: Type.Union([Type.Integer({ minimum: MEMORY_LIMIT_MIN_MB }), Type.Null()]),
  appliesTo: ResourceAppliesToSchema,
});
export type ResourceSettings = Static<typeof ResourceSettingsSchema>;

export const DEFAULT_RESOURCE_SETTINGS: ResourceSettings = {
  priority: "off",
  heavySlots: null,
  memoryLimitMb: null,
  appliesTo: { main: false, worktrees: false, subagents: true },
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
