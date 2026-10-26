import type { ConversationId, Harness, Tx } from "@earendil-works/pi-durable";
import {
  type AdmissionReceipt,
  AppError,
  isTerminalLifecycle,
  type ProjectionCursor,
  type RuntimeLifecycle,
} from "@tau/protocol";
import type { NativeEvent } from "../runtimes/native/events";
import type { AdmitRequest } from "../runtimes/types";
import { BACKGROUND } from "./open";
import {
  appendFrame,
  boundedHistory,
  type CancelState,
  countQueued,
  fingerprintOf,
  type InboxItem,
  isUnresolved,
  NativeCancelsDoc,
  NativeEventsDoc,
  NativeInboxDoc,
  type NativeOperation,
  NativeOperationDoc,
  type NativeOperationRecord,
  NativeProjectionDoc,
  NativeThreadDoc,
  type OperationAcknowledgement,
  type OperationIdentity,
  type OperationSummary,
  type ProjectionFrame,
  plainItem,
  plainJson,
  plainOperation,
  receiptIdOf,
  receiptOf,
  type StoredEvent,
  summaryOf,
} from "./runtime-docs";
import { nextLifecycle, settleOperation } from "./runtime-lifecycle";
import {
  acknowledgedNotice,
  entryDraftOf,
  type LifecycleDetails,
  lifecycleEvent,
  queueEvent,
  userEvent,
} from "./runtime-store-events";

export type StoreInspection = {
  lifecycle: RuntimeLifecycle | undefined;
  epoch: number;
  cursorRevision: number;
  unresolved: number;
  cancelsInFlight: number;
};

export type LaunchIntent = { operationId: string; nonce: string };

export const CANCELLED_BEFORE_LAUNCH = "cancelled before launch";

export type LaunchIntentResult = { readonly kind: "recorded" } | { readonly kind: "cancelled-before-launch" };

export type CancelBeforeLaunchRequest = "requested" | "launched" | "nothing-pending";

export type SettleOutcome = Extract<
  RuntimeLifecycle,
  "completed" | "failed" | "cancelled" | "interrupted" | "outcome-unknown"
>;

export type CancelSettlement = Exclude<CancelState, "stopping">;

export type OperationState = {
  lifecycle: RuntimeLifecycle | undefined;
  operation: NativeOperation | undefined;
  eventCount: number;
  sessionId: string | undefined;
  acknowledgement: OperationAcknowledgement | undefined;
  history: readonly OperationSummary[];
  cancelRequested: boolean;
};

export type SetLifecycleOptions = { restart?: boolean };

export type StoreWindow = { cursor: ProjectionCursor; frames: readonly ProjectionFrame[] };

export interface RuntimeStore {
  readonly threadId: string;
  admit(req: AdmitRequest): Promise<AdmissionReceipt>;
  pending(): Promise<readonly InboxItem[]>;
  markDelivered(requestId: string): Promise<void>;
  cancelQueued(requestId: string): Promise<void>;
  inspect(): Promise<StoreInspection>;
  window(): Promise<StoreWindow>;
  bumpEpoch(): Promise<number>;
  setLifecycle(lifecycle: RuntimeLifecycle, options?: SetLifecycleOptions): Promise<void>;
  beginOperation(): Promise<void>;
  acknowledgeUnknown(input: { operationId: string; note: string }): Promise<void>;
  recordCancel(operationId: string): Promise<CancelState>;
  settleCancels(outcome?: CancelSettlement, reason?: string): Promise<void>;
  requestCancelBeforeLaunch(): Promise<CancelBeforeLaunchRequest>;
  clearCancelRequest(): Promise<void>;
  recordLaunchIntent(intent: LaunchIntent): Promise<LaunchIntentResult>;
  recordIdentity(identity: OperationIdentity): Promise<void>;
  recordSession(sessionId: string): Promise<void>;
  markDeliveredOnce(requestId: string): Promise<void>;
  appendEvent(event: NativeEvent): Promise<{ revision: number }>;
  settle(outcome: SettleOutcome, reason?: string): Promise<void>;
  operationState(): Promise<OperationState>;
  events(): Promise<readonly StoredEvent[]>;
}

export type RuntimeStoreOptions = { now?: () => number };

const STEER_UNSUPPORTED = "Native steer delivery is not supported yet.";

function invalidRequest(message: string): AppError {
  return new AppError("invalid_request", message);
}

function assertDeliverySupported(req: AdmitRequest): void {
  if (req.payload.delivery === "steer") throw invalidRequest(STEER_UNSUPPORTED);
}

function assertSamePayload(item: InboxItem, fingerprint: string): void {
  if (item.fingerprint !== fingerprint) {
    throw invalidRequest(`Request ${item.requestId} was already admitted with a different payload.`);
  }
}

function assertLifecycleChange(
  current: RuntimeLifecycle | undefined,
  next: RuntimeLifecycle,
  options: SetLifecycleOptions = {},
): void {
  if (isTerminalLifecycle(next)) {
    const settled = settleOperation(current, next);
    if (!settled.ok) throw invalidRequest(`Cannot settle as ${next}: ${settled.reason}.`);
    return;
  }
  const legal = current === undefined ? next === "accepted" : nextLifecycle(current, next, options);
  if (!legal) throw invalidRequest(`Illegal lifecycle transition ${current ?? "none"} -> ${next}.`);
}

function assertUnresolved(operation: NativeOperation | undefined): NativeOperation {
  if (operation === undefined) throw invalidRequest("No native operation has recorded a launch intent.");
  if (!isUnresolved(operation))
    throw invalidRequest(`Operation ${operation.operationId} is already settled.`);
  return operation;
}

function assertSettleAllowed(current: RuntimeLifecycle | undefined, outcome: SettleOutcome): void {
  assertLifecycleChange(current, outcome);
  if (current === "cancelling" && !nextLifecycle(current, outcome)) {
    throw invalidRequest(`Cannot settle as ${outcome} while cancelling.`);
  }
}

const PRE_LAUNCH: readonly RuntimeLifecycle[] = ["accepted", "preparing", "ready", "blocked"];

const isAcknowledged = (record: NativeOperationRecord, operation: NativeOperation): boolean =>
  record.acknowledgement?.operationId === operation.operationId;

type BeginPlan = "start" | "continue" | "archive";

function planBegin(record: NativeOperationRecord, lifecycle: RuntimeLifecycle | undefined): BeginPlan {
  const current = record.operation;
  if (current === undefined) {
    if (lifecycle === undefined) return "start";
    if (PRE_LAUNCH.includes(lifecycle)) return "continue";
    throw invalidRequest(`Cannot begin an operation from lifecycle ${lifecycle} without an operation.`);
  }
  if (isUnresolved(current)) throw invalidRequest(`Operation ${current.operationId} is still unresolved.`);
  if (current.terminal?.lifecycle === "outcome-unknown" && !isAcknowledged(record, current)) {
    throw invalidRequest(
      `Operation ${current.operationId} ended with an unknown outcome; acknowledge it first.`,
    );
  }
  return "archive";
}

const sameIdentity = (left: OperationIdentity, right: OperationIdentity): boolean =>
  left.pid === right.pid &&
  left.startTime === right.startTime &&
  left.nonce === right.nonce &&
  left.pgid === right.pgid;

export function createRuntimeStore(
  harness: Harness,
  threadId: string,
  options: RuntimeStoreOptions = {},
): RuntimeStore {
  const id = Number(threadId) as ConversationId;
  const now = options.now ?? Date.now;
  const commit = <T>(body: (tx: Tx) => Promise<T>): Promise<T> => harness.commit(body, BACKGROUND);

  const docs = async (tx: Tx) => ({
    thread: await tx.doc(NativeThreadDoc, id),
    inbox: await tx.doc(NativeInboxDoc, id),
    projection: await tx.doc(NativeProjectionDoc, id),
    cancels: await tx.doc(NativeCancelsDoc, id),
    operation: await tx.doc(NativeOperationDoc, id),
    eventLog: await tx.doc(NativeEventsDoc, id),
  });
  type Docs = Awaited<ReturnType<typeof docs>>;
  type Emit = (event: NativeEvent) => void;

  async function mutate<T>(body: (state: Docs, emit: Emit) => T | Promise<T>): Promise<T> {
    return commit(async (tx) => {
      const pending: NativeEvent[] = [];
      const result = await body(await docs(tx), (event) => void pending.push(event));
      for (const event of pending) await tx.appendEntry(id, entryDraftOf(event));
      return result;
    });
  }

  const emitLifecycle = (
    { projection }: Docs,
    emit: Emit,
    lifecycle: RuntimeLifecycle,
    details?: LifecycleDetails,
  ): void => emit(lifecycleEvent(projection.revision, lifecycle, details));

  const currentOperationId = (state: Docs): LifecycleDetails => {
    const operationId = state.operation.operation?.operationId;
    return operationId === undefined ? {} : { operationId };
  };

  function itemOf(inbox: Docs["inbox"], requestId: string): InboxItem {
    const item = inbox.items.find((candidate) => candidate.requestId === requestId);
    if (!item) throw new AppError("not_found", `Request ${requestId} was never admitted.`);
    return item;
  }

  function admitNew(state: Docs, emit: Emit, req: AdmitRequest, fingerprint: string): InboxItem {
    const { thread, inbox, projection } = state;
    if (thread.createdAt === 0) thread.createdAt = now();
    const firstAdmission = thread.lifecycle === undefined;
    if (firstAdmission) thread.lifecycle = "accepted";
    const seq = inbox.items.length + 1;
    inbox.items.push({
      requestId: req.requestId,
      receiptId: receiptIdOf(threadId, thread.epoch, seq),
      epoch: thread.epoch,
      fingerprint,
      text: req.payload.text,
      attachmentIds: [...req.payload.attachmentIds],
      origin: req.payload.origin,
      delivery: req.payload.delivery,
      admittedAt: now(),
      disposition: "queued",
    });
    appendFrame(projection, 1);
    const item = plainItem(inbox.items[seq - 1] as InboxItem);
    if (firstAdmission) emitLifecycle(state, emit, "accepted");
    emit(userEvent(item));
    emit(queueEvent(item.requestId, "queued"));
    return item;
  }

  async function admit(req: AdmitRequest): Promise<AdmissionReceipt> {
    assertDeliverySupported(req);
    const fingerprint = fingerprintOf(req.payload);
    return mutate((state, emit) => {
      const existing = state.inbox.items.find((item) => item.requestId === req.requestId);
      if (existing) {
        assertSamePayload(existing, fingerprint);
        return receiptOf(threadId, plainItem(existing));
      }
      return receiptOf(threadId, admitNew(state, emit, req, fingerprint));
    });
  }

  async function pending(): Promise<readonly InboxItem[]> {
    return commit(async (tx) => {
      const { inbox } = await docs(tx);
      return inbox.items.filter((item) => item.disposition === "queued").map(plainItem);
    });
  }

  async function resolve(requestId: string, to: "delivered" | "cancelled"): Promise<void> {
    await mutate(({ inbox, projection, operation }, emit) => {
      const item = itemOf(inbox, requestId);
      if (item.disposition === to) return;
      if (item.disposition !== "queued") {
        throw invalidRequest(`Request ${requestId} is already ${item.disposition}.`);
      }
      item.disposition = to;
      appendFrame(projection, 1);
      const announcedByDeliveredOnce = operation.operation?.deliveredRequestId === requestId;
      if (to === "cancelled" || !announcedByDeliveredOnce) emit(queueEvent(requestId, to));
    });
  }

  async function inspect(): Promise<StoreInspection> {
    return commit(async (tx) => {
      const { thread, inbox, projection, cancels } = await docs(tx);
      return {
        lifecycle: thread.lifecycle,
        epoch: thread.epoch,
        cursorRevision: projection.revision,
        unresolved: countQueued(inbox.items),
        cancelsInFlight: Object.values(cancels.operations).filter((state) => state === "stopping").length,
      };
    });
  }

  async function window(): Promise<StoreWindow> {
    return commit(async (tx) => {
      const { thread, projection } = await docs(tx);
      return {
        cursor: { epoch: thread.epoch, revision: projection.revision },
        frames: projection.frames.map((frame) => ({ ...frame })),
      };
    });
  }

  async function bumpEpoch(): Promise<number> {
    return commit(async (tx) => {
      const { thread } = await docs(tx);
      thread.epoch += 1;
      return thread.epoch;
    });
  }

  async function setLifecycle(lifecycle: RuntimeLifecycle, options: SetLifecycleOptions = {}): Promise<void> {
    await mutate((state, emit) => {
      const { thread, projection } = state;
      assertLifecycleChange(thread.lifecycle, lifecycle, options);
      thread.lifecycle = lifecycle;
      appendFrame(projection, 1);
      emitLifecycle(state, emit, lifecycle, currentOperationId(state));
    });
  }

  function archiveCurrent(record: Docs["operation"]): void {
    const finished = record.operation as NativeOperation;
    const acknowledgement = isAcknowledged(record, finished) ? record.acknowledgement : undefined;
    record.history = boundedHistory([...(record.history ?? []), summaryOf(finished, acknowledgement)]);
    delete record.operation;
    delete record.acknowledgement;
  }

  async function beginOperation(): Promise<void> {
    await mutate((state, emit) => {
      const { thread, projection, operation } = state;
      const plan = planBegin(operation, thread.lifecycle);
      if (plan === "continue") return;
      if (plan === "archive") archiveCurrent(operation);
      thread.lifecycle = "accepted";
      if (thread.createdAt === 0) thread.createdAt = now();
      appendFrame(projection, 1);
      emitLifecycle(state, emit, "accepted");
    });
  }

  async function acknowledgeUnknown(input: { operationId: string; note: string }): Promise<void> {
    if (!input.note.trim()) throw invalidRequest("An acknowledgement needs a note.");
    await mutate((state, emit) => {
      const { projection, operation } = state;
      const current = operation.operation;
      if (current?.operationId !== input.operationId) {
        throw new AppError("not_found", `Operation ${input.operationId} is not the current operation.`);
      }
      if (current.terminal?.lifecycle !== "outcome-unknown") {
        throw invalidRequest(`Operation ${current.operationId} did not end with an unknown outcome.`);
      }
      if (isAcknowledged(operation, current)) return;
      operation.acknowledgement = { operationId: current.operationId, note: input.note, at: now() };
      appendFrame(projection, 1);
      emitLifecycle(state, emit, "outcome-unknown", {
        operationId: current.operationId,
        reason: `acknowledged: ${input.note}`,
      });
      emit(acknowledgedNotice(current.operationId, input.note));
    });
  }

  function cancelStateFor(lifecycle: RuntimeLifecycle | undefined): CancelState {
    if (lifecycle === "outcome-unknown") return "unknown";
    return lifecycle !== undefined && isTerminalLifecycle(lifecycle) ? "stopped" : "stopping";
  }

  async function recordCancel(operationId: string): Promise<CancelState> {
    return mutate((docsState, emit) => {
      const { thread, projection, cancels } = docsState;
      const known = cancels.operations[operationId];
      if (known !== undefined) return known;
      const state = cancelStateFor(thread.lifecycle);
      cancels.operations[operationId] = state;
      const startsCancelling =
        state === "stopping" &&
        thread.lifecycle !== undefined &&
        nextLifecycle(thread.lifecycle, "cancelling");
      if (startsCancelling) thread.lifecycle = "cancelling";
      appendFrame(projection, 1);
      if (startsCancelling) emitLifecycle(docsState, emit, "cancelling", { operationId });
      return state;
    });
  }

  function closeStoppingCancels(cancels: Docs["cancels"], state: CancelSettlement): number {
    const stopping = Object.keys(cancels.operations).filter((key) => cancels.operations[key] === "stopping");
    for (const key of stopping) cancels.operations[key] = state;
    return stopping.length;
  }

  const OUTCOME_OF_CANCEL: Readonly<Record<CancelSettlement, SettleOutcome | undefined>> = {
    stopped: "cancelled",
    unknown: "outcome-unknown",
    denied: undefined,
  };

  const cancelStateOfOutcome = (outcome: SettleOutcome): CancelSettlement =>
    outcome === "outcome-unknown" ? "unknown" : "stopped";

  async function settleCancels(outcome: CancelSettlement = "stopped", reason?: string): Promise<void> {
    await mutate((state, emit) => {
      const { thread, projection, cancels, operation } = state;
      const closed = closeStoppingCancels(cancels, outcome);
      if (closed === 0) return;
      const terminal = OUTCOME_OF_CANCEL[outcome];
      const settled = terminal ? settleOperation(thread.lifecycle, terminal) : undefined;
      if (settled?.ok) thread.lifecycle = settled.lifecycle;
      const launched = operation.operation;
      if (settled?.ok && launched && isUnresolved(launched)) {
        launched.terminal = {
          lifecycle: settled.lifecycle,
          at: now(),
          ...(reason !== undefined && { reason }),
        };
      }
      appendFrame(projection, closed);
      if (settled?.ok) {
        const details = { ...currentOperationId(state), ...(reason !== undefined && { reason }) };
        emitLifecycle(state, emit, settled.lifecycle, details);
      }
    });
  }

  async function requestCancelBeforeLaunch(): Promise<CancelBeforeLaunchRequest> {
    return commit(async (tx) => {
      const { thread, inbox, operation } = await docs(tx);
      if (isUnresolved(operation.operation)) return "launched";
      if (thread.lifecycle === undefined || countQueued(inbox.items) === 0) return "nothing-pending";
      operation.cancelRequested = true;
      return "requested";
    });
  }

  async function clearCancelRequest(): Promise<void> {
    await commit(async (tx) => {
      const { operation } = await docs(tx);
      if (operation.cancelRequested !== undefined) delete operation.cancelRequested;
    });
  }

  function settleCancelledBeforeLaunch(state: Docs, emit: Emit, intent: LaunchIntent): LaunchIntentResult {
    const { thread, projection, operation } = state;
    delete operation.cancelRequested;
    thread.lifecycle = "cancelled";
    operation.operation = {
      operationId: intent.operationId,
      nonce: intent.nonce,
      terminal: { lifecycle: "cancelled", at: now(), reason: CANCELLED_BEFORE_LAUNCH },
    };
    appendFrame(projection, 1);
    emitLifecycle(state, emit, "cancelled", {
      operationId: intent.operationId,
      reason: CANCELLED_BEFORE_LAUNCH,
    });
    return { kind: "cancelled-before-launch" };
  }

  async function recordLaunchIntent(intent: LaunchIntent): Promise<LaunchIntentResult> {
    if (!intent.operationId || !intent.nonce)
      throw invalidRequest("A launch intent needs an operation id and a nonce.");
    return mutate((state, emit) => {
      const { thread, projection, operation } = state;
      const previous = operation.operation;
      if (previous && isUnresolved(previous)) {
        throw invalidRequest(`Operation ${previous.operationId} is still unresolved.`);
      }
      if (thread.lifecycle === undefined || !nextLifecycle(thread.lifecycle, "starting")) {
        throw invalidRequest(`Cannot launch from lifecycle ${thread.lifecycle ?? "none"}.`);
      }
      if (operation.cancelRequested) return settleCancelledBeforeLaunch(state, emit, intent);
      thread.lifecycle = "starting";
      operation.operation = { operationId: intent.operationId, nonce: intent.nonce, launchIntentAt: now() };
      appendFrame(projection, 1);
      emitLifecycle(state, emit, "starting", { operationId: intent.operationId });
      return { kind: "recorded" };
    });
  }

  async function recordIdentity(identity: OperationIdentity): Promise<void> {
    await commit(async (tx) => {
      const { projection, operation } = await docs(tx);
      const current = assertUnresolved(operation.operation);
      if (identity.nonce !== current.nonce)
        throw invalidRequest("Process identity does not match the launch nonce.");
      if (current.identity) {
        if (sameIdentity(current.identity, identity)) return;
        throw invalidRequest(`Operation ${current.operationId} already has a different process identity.`);
      }
      current.identity = { ...identity };
      appendFrame(projection, 1);
    });
  }

  async function recordSession(sessionId: string): Promise<void> {
    if (!sessionId) throw invalidRequest("A session id cannot be empty.");
    await commit(async (tx) => {
      const { thread, projection, operation } = await docs(tx);
      const current = assertUnresolved(operation.operation);
      if (current.sessionId === sessionId) return;
      if (current.sessionId !== undefined) {
        throw invalidRequest(
          `Operation ${current.operationId} already belongs to session ${current.sessionId}.`,
        );
      }
      if (thread.sessionId !== undefined && thread.sessionId !== sessionId) {
        throw invalidRequest(`Thread ${threadId} already belongs to session ${thread.sessionId}.`);
      }
      current.sessionId = sessionId;
      thread.sessionId = sessionId;
      appendFrame(projection, 1);
    });
  }

  async function markDeliveredOnce(requestId: string): Promise<void> {
    if (!requestId) throw invalidRequest("A delivered request id cannot be empty.");
    await mutate(({ inbox, projection, operation }, emit) => {
      const current = assertUnresolved(operation.operation);
      if (current.deliveredRequestId === requestId) return;
      if (current.deliveredRequestId !== undefined) {
        throw invalidRequest(
          `Operation ${current.operationId} already delivered ${current.deliveredRequestId}.`,
        );
      }
      current.deliveredRequestId = requestId;
      appendFrame(projection, 1);
      const alreadyAnnounced =
        inbox.items.find((item) => item.requestId === requestId)?.disposition === "delivered";
      if (!alreadyAnnounced) emit(queueEvent(requestId, "delivered"));
    });
  }

  async function appendEvent(event: NativeEvent): Promise<{ revision: number }> {
    return mutate(({ projection, eventLog }, emit) => {
      const existing = eventLog.entries.find((entry) => entry.key === event.key);
      if (existing) return { revision: existing.revision };
      appendFrame(projection, 1);
      eventLog.entries.push({ revision: projection.revision, key: event.key, event: plainJson(event) });
      emit(event);
      return { revision: projection.revision };
    });
  }

  async function settle(outcome: SettleOutcome, reason?: string): Promise<void> {
    await mutate((state, emit) => {
      const { thread, projection, operation, cancels } = state;
      const current = operation.operation;
      if (current === undefined) throw invalidRequest("No native operation has recorded a launch intent.");
      assertSettleAllowed(thread.lifecycle, outcome);
      thread.lifecycle = outcome;
      closeStoppingCancels(cancels, cancelStateOfOutcome(outcome));
      current.terminal = { lifecycle: outcome, at: now(), ...(reason !== undefined && { reason }) };
      appendFrame(projection, 1);
      emitLifecycle(state, emit, outcome, {
        operationId: current.operationId,
        ...(reason !== undefined && { reason }),
      });
    });
  }

  async function operationState(): Promise<OperationState> {
    return commit(async (tx) => {
      const { thread, operation, eventLog } = await docs(tx);
      return {
        cancelRequested: operation.cancelRequested === true,
        lifecycle: thread.lifecycle,
        operation: operation.operation ? plainOperation(operation.operation) : undefined,
        eventCount: eventLog.entries.length,
        sessionId: thread.sessionId,
        acknowledgement: operation.acknowledgement ? { ...operation.acknowledgement } : undefined,
        history: (operation.history ?? []).map((summary) => plainJson(summary)),
      };
    });
  }

  async function events(): Promise<readonly StoredEvent[]> {
    return commit(async (tx) => {
      const { eventLog } = await docs(tx);
      return eventLog.entries.map((entry) => ({ ...entry, event: plainJson(entry.event) }));
    });
  }

  return {
    threadId,
    admit,
    pending,
    markDelivered: (requestId) => resolve(requestId, "delivered"),
    cancelQueued: (requestId) => resolve(requestId, "cancelled"),
    inspect,
    window,
    bumpEpoch,
    setLifecycle,
    beginOperation,
    acknowledgeUnknown,
    recordCancel,
    settleCancels,
    requestCancelBeforeLaunch,
    clearCancelRequest,
    recordLaunchIntent,
    recordIdentity,
    recordSession,
    markDeliveredOnce,
    appendEvent,
    settle,
    operationState,
    events,
  };
}
