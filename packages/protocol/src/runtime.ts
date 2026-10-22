import { type Static, Type } from "typebox";

export const EXECUTOR_KINDS = ["pi", "claude-code"] as const;
export const ExecutorKindSchema = Type.Union([Type.Literal("pi"), Type.Literal("claude-code")]);
export type ExecutorKind = Static<typeof ExecutorKindSchema>;

/** Stored data that omits the executor means this one; it is never derived from a model name. */
export const DEFAULT_EXECUTOR: ExecutorKind = "pi";

export function executorOf(value: { executor?: ExecutorKind } | undefined): ExecutorKind {
  return value?.executor ?? DEFAULT_EXECUTOR;
}

export const RUNTIME_CAPABILITY_KEYS = [
  "followUp",
  "steer",
  "approvals",
  "compact",
  "nativeFork",
  "contextualHandoff",
  "fileRewind",
  "background",
  "timers",
  "delegation",
] as const;
export type RuntimeCapabilityKey = (typeof RUNTIME_CAPABILITY_KEYS)[number];

export const CapabilityStateSchema = Type.Object({
  supported: Type.Boolean(),
  reason: Type.Optional(Type.String()),
});
export type CapabilityState = Static<typeof CapabilityStateSchema>;

export const RuntimeCapabilitiesSchema = Type.Object({
  followUp: CapabilityStateSchema,
  steer: CapabilityStateSchema,
  approvals: CapabilityStateSchema,
  compact: CapabilityStateSchema,
  nativeFork: CapabilityStateSchema,
  contextualHandoff: CapabilityStateSchema,
  fileRewind: CapabilityStateSchema,
  background: CapabilityStateSchema,
  timers: CapabilityStateSchema,
  delegation: CapabilityStateSchema,
});
export type RuntimeCapabilities = Static<typeof RuntimeCapabilitiesSchema>;

export function unsupportedCapabilities(reason: string): RuntimeCapabilities {
  const entries = RUNTIME_CAPABILITY_KEYS.map((key) => [key, { supported: false, reason }]);
  return Object.fromEntries(entries) as RuntimeCapabilities;
}

export const RUNTIME_LIFECYCLES = [
  "accepted",
  "preparing",
  "ready",
  "starting",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelling",
  "cancelled",
  "interrupted",
  "outcome-unknown",
  "reconciling",
] as const;
export const RuntimeLifecycleSchema = Type.Union([
  Type.Literal("accepted"),
  Type.Literal("preparing"),
  Type.Literal("ready"),
  Type.Literal("starting"),
  Type.Literal("running"),
  Type.Literal("blocked"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelling"),
  Type.Literal("cancelled"),
  Type.Literal("interrupted"),
  Type.Literal("outcome-unknown"),
  Type.Literal("reconciling"),
]);
export type RuntimeLifecycle = Static<typeof RuntimeLifecycleSchema>;

export const TERMINAL_LIFECYCLES = [
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "outcome-unknown",
] as const;

export function isTerminalLifecycle(lifecycle: RuntimeLifecycle): boolean {
  return (TERMINAL_LIFECYCLES as readonly RuntimeLifecycle[]).includes(lifecycle);
}

export function isSuccessfulLifecycle(lifecycle: RuntimeLifecycle): boolean {
  return lifecycle === "completed";
}

export const WRITER_STATES = ["running", "cancelling", "reconciling", "settled", "unknown"] as const;
export const WriterStateSchema = Type.Union([
  Type.Literal("running"),
  Type.Literal("cancelling"),
  Type.Literal("reconciling"),
  Type.Literal("settled"),
  Type.Literal("unknown"),
]);
export type WriterState = Static<typeof WriterStateSchema>;

/** Only a settled writer may have its worktree destroyed; unknown denies destruction. */
export function isSafeToDestroy(state: WriterState): boolean {
  return state === "settled";
}

export const PAYLOAD_IDENTITIES = ["fingerprinted", "legacy-payload-unverified"] as const;
export const PayloadIdentitySchema = Type.Union([
  Type.Literal("fingerprinted"),
  Type.Literal("legacy-payload-unverified"),
]);
export type PayloadIdentity = Static<typeof PayloadIdentitySchema>;

export const AdmissionReceiptSchema = Type.Object({
  receiptId: Type.String({ minLength: 1 }),
  threadId: Type.String({ minLength: 1 }),
  requestId: Type.String({ minLength: 1 }),
  executor: ExecutorKindSchema,
  epoch: Type.Integer({ minimum: 0 }),
  payloadIdentity: PayloadIdentitySchema,
  payloadFingerprint: Type.Optional(Type.String()),
  admittedAt: Type.Number(),
});
export type AdmissionReceipt = Static<typeof AdmissionReceiptSchema>;

export const CANCEL_OUTCOMES = ["stopped", "stopping", "denied", "unknown"] as const;
export const CancelOutcomeSchema = Type.Union([
  Type.Literal("stopped"),
  Type.Literal("stopping"),
  Type.Literal("denied"),
  Type.Literal("unknown"),
]);
export type CancelOutcome = Static<typeof CancelOutcomeSchema>;

export const CancelReceiptSchema = Type.Object({
  operationId: Type.String({ minLength: 1 }),
  intentRecorded: Type.Boolean(),
  outcome: CancelOutcomeSchema,
  reason: Type.Optional(Type.String()),
});
export type CancelReceipt = Static<typeof CancelReceiptSchema>;

export function isConfirmedStopped(receipt: CancelReceipt): boolean {
  return receipt.outcome === "stopped";
}

export const ProjectionCursorSchema = Type.Object({
  epoch: Type.Integer({ minimum: 0 }),
  revision: Type.Integer({ minimum: 0 }),
});
export type ProjectionCursor = Static<typeof ProjectionCursorSchema>;

export const ObserveUpdateKindSchema = Type.Union([Type.Literal("update"), Type.Literal("reset")]);
export type ObserveUpdateKind = Static<typeof ObserveUpdateKindSchema>;

/** Frames only ordering and reset; payload bodies travel elsewhere. */
export const ObserveFrameSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("update"),
    cursor: ProjectionCursorSchema,
    count: Type.Integer({ minimum: 0 }),
  }),
  Type.Object({
    kind: Type.Literal("reset"),
    cursor: ProjectionCursorSchema,
    reason: Type.Optional(Type.String()),
  }),
]);
export type ObserveFrame = Static<typeof ObserveFrameSchema>;

export function isStaleEpoch(current: ProjectionCursor, incoming: ProjectionCursor): boolean {
  return incoming.epoch < current.epoch;
}

export const RECONCILE_OUTCOMES = ["known-live", "settled", "interrupted", "outcome-unknown"] as const;
export const ReconcileOutcomeSchema = Type.Union([
  Type.Literal("known-live"),
  Type.Literal("settled"),
  Type.Literal("interrupted"),
  Type.Literal("outcome-unknown"),
]);
export type ReconcileOutcome = Static<typeof ReconcileOutcomeSchema>;

export const RuntimeDescriptorSchema = Type.Object({
  executor: ExecutorKindSchema,
  capabilities: RuntimeCapabilitiesSchema,
  lifecycle: Type.Optional(RuntimeLifecycleSchema),
});
export type RuntimeDescriptor = Static<typeof RuntimeDescriptorSchema>;

export const RUNTIME_UNSUPPORTED_REASON = "executor-disabled";
