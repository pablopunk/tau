import type { ConversationId, Harness, Tx } from "@earendil-works/pi-durable";
import {
  type AdmissionReceipt,
  AppError,
  isTerminalLifecycle,
  type ProjectionCursor,
  type RuntimeLifecycle,
} from "@tau/protocol";
import type { AdmitRequest } from "../runtimes/types";
import { BACKGROUND } from "./open";
import {
  appendFrame,
  type CancelState,
  countQueued,
  fingerprintOf,
  type InboxItem,
  NativeCancelsDoc,
  NativeInboxDoc,
  NativeProjectionDoc,
  NativeThreadDoc,
  type ProjectionFrame,
  plainItem,
  receiptIdOf,
  receiptOf,
} from "./runtime-docs";
import { nextLifecycle, settleOperation } from "./runtime-lifecycle";

export type StoreInspection = {
  lifecycle: RuntimeLifecycle | undefined;
  epoch: number;
  cursorRevision: number;
  unresolved: number;
  cancelsInFlight: number;
};

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
  setLifecycle(lifecycle: RuntimeLifecycle): Promise<void>;
  recordCancel(operationId: string): Promise<CancelState>;
  settleCancels(): Promise<void>;
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

function assertLifecycleChange(current: RuntimeLifecycle | undefined, next: RuntimeLifecycle): void {
  if (isTerminalLifecycle(next)) {
    const settled = settleOperation(current, next);
    if (!settled.ok) throw invalidRequest(`Cannot settle as ${next}: ${settled.reason}.`);
    return;
  }
  const legal = current === undefined ? next === "accepted" : nextLifecycle(current, next);
  if (!legal) throw invalidRequest(`Illegal lifecycle transition ${current ?? "none"} -> ${next}.`);
}

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
  });
  type Docs = Awaited<ReturnType<typeof docs>>;

  function itemOf(inbox: Docs["inbox"], requestId: string): InboxItem {
    const item = inbox.items.find((candidate) => candidate.requestId === requestId);
    if (!item) throw new AppError("not_found", `Request ${requestId} was never admitted.`);
    return item;
  }

  function admitNew(state: Docs, req: AdmitRequest, fingerprint: string): InboxItem {
    const { thread, inbox, projection } = state;
    if (thread.createdAt === 0) thread.createdAt = now();
    if (thread.lifecycle === undefined) thread.lifecycle = "accepted";
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
    return plainItem(inbox.items[seq - 1] as InboxItem);
  }

  async function admit(req: AdmitRequest): Promise<AdmissionReceipt> {
    assertDeliverySupported(req);
    const fingerprint = fingerprintOf(req.payload);
    return commit(async (tx) => {
      const state = await docs(tx);
      const existing = state.inbox.items.find((item) => item.requestId === req.requestId);
      if (existing) {
        assertSamePayload(existing, fingerprint);
        return receiptOf(threadId, plainItem(existing));
      }
      return receiptOf(threadId, admitNew(state, req, fingerprint));
    });
  }

  async function pending(): Promise<readonly InboxItem[]> {
    return commit(async (tx) => {
      const { inbox } = await docs(tx);
      return inbox.items.filter((item) => item.disposition === "queued").map(plainItem);
    });
  }

  async function resolve(requestId: string, to: "delivered" | "cancelled"): Promise<void> {
    await commit(async (tx) => {
      const { inbox, projection } = await docs(tx);
      const item = itemOf(inbox, requestId);
      if (item.disposition === to) return;
      if (item.disposition !== "queued") {
        throw invalidRequest(`Request ${requestId} is already ${item.disposition}.`);
      }
      item.disposition = to;
      appendFrame(projection, 1);
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

  async function setLifecycle(lifecycle: RuntimeLifecycle): Promise<void> {
    await commit(async (tx) => {
      const { thread, projection } = await docs(tx);
      assertLifecycleChange(thread.lifecycle, lifecycle);
      thread.lifecycle = lifecycle;
      appendFrame(projection, 1);
    });
  }

  function cancelStateFor(lifecycle: RuntimeLifecycle | undefined): CancelState {
    if (lifecycle === "outcome-unknown") return "unknown";
    return lifecycle !== undefined && isTerminalLifecycle(lifecycle) ? "stopped" : "stopping";
  }

  async function recordCancel(operationId: string): Promise<CancelState> {
    return commit(async (tx) => {
      const { thread, projection, cancels } = await docs(tx);
      const known = cancels.operations[operationId];
      if (known !== undefined) return known;
      const state = cancelStateFor(thread.lifecycle);
      cancels.operations[operationId] = state;
      if (
        state === "stopping" &&
        thread.lifecycle !== undefined &&
        nextLifecycle(thread.lifecycle, "cancelling")
      ) {
        thread.lifecycle = "cancelling";
      }
      appendFrame(projection, 1);
      return state;
    });
  }

  async function settleCancels(): Promise<void> {
    await commit(async (tx) => {
      const { thread, projection, cancels } = await docs(tx);
      const stopping = Object.keys(cancels.operations).filter(
        (key) => cancels.operations[key] === "stopping",
      );
      if (stopping.length === 0) return;
      for (const key of stopping) cancels.operations[key] = "stopped";
      const settled = settleOperation(thread.lifecycle, "cancelled");
      if (settled.ok) thread.lifecycle = settled.lifecycle;
      appendFrame(projection, stopping.length);
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
    recordCancel,
    settleCancels,
  };
}
