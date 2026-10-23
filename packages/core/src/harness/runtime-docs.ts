import { createHash } from "node:crypto";
import { defineDoc } from "@earendil-works/pi-durable";
import {
  type AdmissionReceipt,
  ExecutorKindSchema,
  type ProjectionCursor,
  type RuntimeLifecycle,
  RuntimeLifecycleSchema,
} from "@tau/protocol";
import { type Static, Type } from "typebox";
import type { NativeEvent } from "../runtimes/native/events";
import type { RuntimePayload } from "../runtimes/types";

export const NATIVE_EXECUTOR = "claude-code" as const;
export const RETAINED_FRAMES = 4;

const OriginSchema = Type.Union([
  Type.Literal("user"),
  Type.Literal("timer"),
  Type.Literal("notification"),
  Type.Literal("child-report"),
]);
const DeliverySchema = Type.Union([Type.Literal("queue"), Type.Literal("steer"), Type.Literal("send-now")]);
const DispositionSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("delivered"),
  Type.Literal("cancelled"),
]);

export const InboxItemSchema = Type.Object({
  requestId: Type.String({ minLength: 1 }),
  receiptId: Type.String({ minLength: 1 }),
  epoch: Type.Integer({ minimum: 0 }),
  fingerprint: Type.String({ minLength: 1 }),
  text: Type.String(),
  attachmentIds: Type.Array(Type.String()),
  origin: OriginSchema,
  delivery: DeliverySchema,
  admittedAt: Type.Number(),
  disposition: DispositionSchema,
});
export type InboxItem = Static<typeof InboxItemSchema>;

export const NativeThreadSchema = Type.Object({
  executor: ExecutorKindSchema,
  epoch: Type.Integer({ minimum: 0 }),
  lifecycle: Type.Optional(RuntimeLifecycleSchema),
  sessionId: Type.Optional(Type.String()),
  createdAt: Type.Number(),
  /** The Claude model id chosen at start. Absent on older threads and on starts that took Claude Code's default. */
  model: Type.Optional(Type.String({ minLength: 1 })),
});
export type NativeThread = Static<typeof NativeThreadSchema>;

export const NativeInboxSchema = Type.Object({ items: Type.Array(InboxItemSchema) });
export type NativeInbox = Static<typeof NativeInboxSchema>;

const FrameSchema = Type.Object({
  revision: Type.Integer({ minimum: 1 }),
  count: Type.Integer({ minimum: 0 }),
});
export type ProjectionFrame = Static<typeof FrameSchema>;

export const NativeProjectionSchema = Type.Object({
  revision: Type.Integer({ minimum: 0 }),
  frames: Type.Array(FrameSchema),
});
export type NativeProjection = Static<typeof NativeProjectionSchema>;

export const CancelStateSchema = Type.Union([
  Type.Literal("stopping"),
  Type.Literal("stopped"),
  Type.Literal("unknown"),
  Type.Literal("denied"),
]);
export type CancelState = Static<typeof CancelStateSchema>;

export const NativeCancelsSchema = Type.Object({ operations: Type.Record(Type.String(), CancelStateSchema) });
export type NativeCancels = Static<typeof NativeCancelsSchema>;

export const OperationIdentitySchema = Type.Object({
  pid: Type.Integer({ minimum: 1 }),
  startTime: Type.Number(),
  nonce: Type.String({ minLength: 1 }),
  pgid: Type.Integer({ minimum: 1 }),
});
export type OperationIdentity = Static<typeof OperationIdentitySchema>;

export const OperationTerminalSchema = Type.Object({
  lifecycle: RuntimeLifecycleSchema,
  at: Type.Number(),
  reason: Type.Optional(Type.String()),
});
export type OperationTerminal = Static<typeof OperationTerminalSchema>;

export const NativeOperationSchema = Type.Object({
  operationId: Type.String({ minLength: 1 }),
  nonce: Type.String({ minLength: 1 }),
  launchIntentAt: Type.Optional(Type.Number()),
  identity: Type.Optional(OperationIdentitySchema),
  sessionId: Type.Optional(Type.String({ minLength: 1 })),
  deliveredRequestId: Type.Optional(Type.String({ minLength: 1 })),
  terminal: Type.Optional(OperationTerminalSchema),
});
export type NativeOperation = Static<typeof NativeOperationSchema>;

export const OPERATION_HISTORY_LIMIT = 20;

export type OperationAcknowledgement = { operationId: string; note: string; at: number };

export type OperationSummary = {
  operationId: string;
  lifecycle: RuntimeLifecycle;
  at: number;
  acknowledgement?: { note: string; at: number };
};

export type NativeOperationRecord = {
  operation?: NativeOperation;
  cancelRequested?: boolean;
  acknowledgement?: OperationAcknowledgement;
  history?: OperationSummary[];
};

export type StoredEvent = { revision: number; key: string; event: NativeEvent };
export type NativeEventLog = { entries: StoredEvent[] };

export const NativeThreadDoc = defineDoc<NativeThread>({
  kind: "native.thread",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ executor: NATIVE_EXECUTOR, epoch: 0, createdAt: 0 }),
});

export const NativeInboxDoc = defineDoc<NativeInbox>({
  kind: "native.inbox",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ items: [] }),
});

export const NativeProjectionDoc = defineDoc<NativeProjection>({
  kind: "native.projection",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ revision: 0, frames: [] }),
});

export const NativeCancelsDoc = defineDoc<NativeCancels>({
  kind: "native.cancels",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ operations: {} }),
});

export const NativeOperationDoc = defineDoc<NativeOperationRecord>({
  kind: "native.operation",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({}),
});

export const NativeEventsDoc = defineDoc<NativeEventLog>({
  kind: "native.event",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ entries: [] }),
});

export function fingerprintOf(payload: RuntimePayload): string {
  const canonical = JSON.stringify({
    text: payload.text,
    attachmentIds: [...payload.attachmentIds],
    origin: payload.origin,
    delivery: payload.delivery,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export const receiptIdOf = (threadId: string, epoch: number, seq: number): string =>
  `${threadId}:${epoch}:${seq}`;

export function receiptOf(threadId: string, item: InboxItem): AdmissionReceipt {
  return {
    receiptId: item.receiptId,
    threadId,
    requestId: item.requestId,
    executor: NATIVE_EXECUTOR,
    epoch: item.epoch,
    payloadIdentity: "fingerprinted",
    payloadFingerprint: item.fingerprint,
    admittedAt: item.admittedAt,
  };
}

export function plainItem(item: InboxItem): InboxItem {
  return { ...item, attachmentIds: [...item.attachmentIds] };
}

export const countQueued = (items: readonly InboxItem[]): number =>
  items.filter((item) => item.disposition === "queued").length;

export const plainJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function plainOperation(operation: NativeOperation): NativeOperation {
  const { identity, terminal, ...rest } = operation;
  return {
    ...rest,
    ...(identity && { identity: { ...identity } }),
    ...(terminal && { terminal: { ...terminal } }),
  };
}

export function summaryOf(
  operation: NativeOperation,
  acknowledgement?: OperationAcknowledgement,
): OperationSummary {
  const terminal = operation.terminal;
  if (!terminal) throw new Error(`Operation ${operation.operationId} has no terminal outcome.`);
  return {
    operationId: operation.operationId,
    lifecycle: terminal.lifecycle,
    at: terminal.at,
    ...(acknowledgement && { acknowledgement: { note: acknowledgement.note, at: acknowledgement.at } }),
  };
}

export const boundedHistory = (history: readonly OperationSummary[]): OperationSummary[] =>
  history.slice(-OPERATION_HISTORY_LIMIT).map((summary) => plainJson(summary));

export const isUnresolved = (operation: NativeOperation | undefined): boolean =>
  operation !== undefined && operation.terminal === undefined;

export function appendFrame(projection: NativeProjection, count: number): void {
  projection.revision += 1;
  projection.frames.push({ revision: projection.revision, count });
  const excess = projection.frames.length - RETAINED_FRAMES;
  if (excess > 0) projection.frames.splice(0, excess);
}

export type ResetReason = "stale-epoch" | "cursor-ahead" | "cursor-outside-retained-window";

export function resetReasonOf(
  current: ProjectionCursor,
  frames: readonly ProjectionFrame[],
  from: ProjectionCursor,
): ResetReason | undefined {
  if (from.epoch < current.epoch) return "stale-epoch";
  if (from.epoch > current.epoch || from.revision > current.revision) return "cursor-ahead";
  const oldest = frames[0];
  if (oldest && oldest.revision > from.revision + 1) return "cursor-outside-retained-window";
  return undefined;
}
