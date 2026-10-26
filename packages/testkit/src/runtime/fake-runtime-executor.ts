import { createHash } from "node:crypto";
import type {
  AdmissionReceipt,
  CancelReceipt,
  ExecutorKind,
  ObserveFrame,
  ProjectionCursor,
  ReconcileOutcome,
  RuntimeCapabilities,
  RuntimeLifecycle,
  WriterState,
} from "@tau/protocol";
import { AppError } from "@tau/protocol";
import type {
  AdmitRequest,
  CancelRequest,
  RuntimeExecutorUnderTest,
  RuntimeInspection,
  RuntimePayload,
} from "./runtime-contract";

export const DEFAULT_RETAINED_FRAMES = 4;

export type FakeRuntimeExecutorOptions = {
  executor?: ExecutorKind;
  legacyRequestIds?: string[];
  retainedFrames?: number;
  clock?: () => number;
};

export interface FakeRuntimeExecutor extends RuntimeExecutorUnderTest {
  settle(): void;
  bumpEpoch(): void;
  snapshot(): unknown;
  restartFrom(snapshot: unknown): FakeRuntimeExecutor;
}

type StoredReceipt = { receipt: AdmissionReceipt; fingerprint: string | undefined };
type StoredFrame = { revision: number; count: number };
type CancelState = "stopping" | "stopped";

type ThreadState = {
  revision: number;
  receipts: Record<string, StoredReceipt>;
  frames: StoredFrame[];
  unresolved: number;
  cancels: Record<string, CancelState>;
};

type FakeState = {
  epoch: number;
  receiptCounter: number;
  clockTicks: number;
  threads: Record<string, ThreadState>;
};

const STEER_UNSUPPORTED_REASON = "steer is not supported by the fake runtime";
const NATIVE_FORK_UNSUPPORTED_REASON = "native fork is not supported by the fake runtime";

export function fakeCapabilities(): RuntimeCapabilities {
  return {
    followUp: { supported: true },
    steer: { supported: false, reason: STEER_UNSUPPORTED_REASON },
    approvals: { supported: true },
    compact: { supported: true },
    nativeFork: { supported: false, reason: NATIVE_FORK_UNSUPPORTED_REASON },
    contextualHandoff: { supported: true },
    fileRewind: { supported: false, reason: "file rewind is not supported by the fake runtime" },
    background: { supported: true },
    timers: { supported: true },
    delegation: { supported: false, reason: "delegation is not supported by the fake runtime" },
  };
}

export function payloadFingerprint(payload: RuntimePayload): string {
  const stable = {
    text: payload.text,
    attachmentIds: [...payload.attachmentIds],
    origin: payload.origin,
    delivery: payload.delivery,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function freshState(): FakeState {
  return { epoch: 1, receiptCounter: 0, clockTicks: 0, threads: {} };
}

function freshThread(): ThreadState {
  return { revision: 0, receipts: {}, frames: [], unresolved: 0, cancels: {} };
}

function invalidRequest(message: string): AppError {
  return new AppError("invalid_request", message);
}

export function createFakeRuntimeExecutor(options: FakeRuntimeExecutorOptions = {}): FakeRuntimeExecutor {
  return buildFake(options, freshState());
}

function buildFake(options: FakeRuntimeExecutorOptions, state: FakeState): FakeRuntimeExecutor {
  const executor = options.executor ?? "pi";
  const legacyIds = new Set(options.legacyRequestIds ?? []);
  const retainedFrames = options.retainedFrames ?? DEFAULT_RETAINED_FRAMES;
  const capabilityTable = fakeCapabilities();

  const now = (): number => (options.clock ? options.clock() : ++state.clockTicks);
  const threadOf = (threadId: string): ThreadState => (state.threads[threadId] ??= freshThread());
  const cursorOf = (thread: ThreadState): ProjectionCursor => ({
    epoch: state.epoch,
    revision: thread.revision,
  });

  function recordFrame(thread: ThreadState, count: number): void {
    thread.revision += 1;
    thread.frames.push({ revision: thread.revision, count });
    thread.frames.splice(0, Math.max(0, thread.frames.length - retainedFrames));
  }

  function assertDeliverySupported(payload: RuntimePayload): void {
    if (payload.delivery === "steer" && !capabilityTable.steer.supported) {
      throw invalidRequest(capabilityTable.steer.reason ?? "steer is not supported");
    }
  }

  function receiptFor(thread: ThreadState, req: AdmitRequest): StoredReceipt {
    const legacy = legacyIds.has(req.requestId);
    state.receiptCounter += 1;
    const fingerprint = legacy ? undefined : payloadFingerprint(req.payload);
    const receipt: AdmissionReceipt = {
      receiptId: `receipt-${state.receiptCounter}`,
      threadId: req.threadId,
      requestId: req.requestId,
      executor,
      epoch: state.epoch,
      payloadIdentity: legacy ? "legacy-payload-unverified" : "fingerprinted",
      ...(fingerprint === undefined ? {} : { payloadFingerprint: fingerprint }),
      admittedAt: now(),
    };
    thread.receipts[req.requestId] = { receipt, fingerprint };
    return thread.receipts[req.requestId] as StoredReceipt;
  }

  function matchesStored(stored: StoredReceipt, payload: RuntimePayload): boolean {
    return stored.fingerprint === undefined || stored.fingerprint === payloadFingerprint(payload);
  }

  async function admit(req: AdmitRequest): Promise<AdmissionReceipt> {
    assertDeliverySupported(req.payload);
    const thread = threadOf(req.threadId);
    const existing = thread.receipts[req.requestId];
    if (existing) {
      if (!matchesStored(existing, req.payload)) {
        throw invalidRequest(`request ${req.requestId} was already admitted with a different payload`);
      }
      return { ...existing.receipt };
    }
    const stored = receiptFor(thread, req);
    thread.unresolved += req.payload.attachmentIds.length;
    recordFrame(thread, 1);
    return { ...stored.receipt };
  }

  function lifecycleOf(thread: ThreadState): RuntimeLifecycle | undefined {
    const states = Object.values(thread.cancels);
    if (states.includes("stopping")) return "cancelling";
    if (states.includes("stopped")) return "cancelled";
    return thread.revision === 0 ? undefined : "accepted";
  }

  function writerOf(thread: ThreadState): WriterState {
    const states = Object.values(thread.cancels);
    if (states.includes("stopping")) return "cancelling";
    if (states.includes("stopped")) return "settled";
    return thread.revision === 0 ? "settled" : "running";
  }

  async function inspect(threadId: string): Promise<RuntimeInspection> {
    const thread = threadOf(threadId);
    return {
      executor,
      capabilities: capabilityTable,
      lifecycle: lifecycleOf(thread),
      writer: writerOf(thread),
      unresolvedOutcomes: thread.unresolved,
      cursor: cursorOf(thread),
    };
  }

  function resetFrame(thread: ThreadState, reason: string): ObserveFrame {
    return { kind: "reset", cursor: cursorOf(thread), reason };
  }

  function needsReset(thread: ThreadState, from: ProjectionCursor): string | undefined {
    if (from.epoch < state.epoch) return "stale-epoch";
    if (from.epoch > state.epoch || from.revision > thread.revision) return "cursor-ahead";
    const oldest = thread.frames[0];
    if (oldest && oldest.revision > from.revision + 1) return "cursor-outside-retained-window";
    return undefined;
  }

  function updateFramesAfter(thread: ThreadState, revision: number): ObserveFrame[] {
    return thread.frames
      .filter((frame) => frame.revision > revision)
      .map((frame) => ({
        kind: "update",
        cursor: { epoch: state.epoch, revision: frame.revision },
        count: frame.count,
      }));
  }

  async function* observe(threadId: string, from: ProjectionCursor | undefined): AsyncIterable<ObserveFrame> {
    const thread = threadOf(threadId);
    const reason = from === undefined ? undefined : needsReset(thread, from);
    if (reason !== undefined) {
      yield resetFrame(thread, reason);
      return;
    }
    yield* updateFramesAfter(thread, from?.revision ?? 0);
  }

  async function cancel(req: CancelRequest): Promise<CancelReceipt> {
    const thread = threadOf(req.threadId);
    if (thread.cancels[req.operationId] === undefined) {
      thread.cancels[req.operationId] = "stopping";
      recordFrame(thread, 1);
    }
    return {
      operationId: req.operationId,
      intentRecorded: true,
      outcome: thread.cancels[req.operationId] as CancelState,
    };
  }

  async function reconcile(threadId: string, epoch: number): Promise<ReconcileOutcome> {
    const thread = threadOf(threadId);
    if (epoch < state.epoch) return "interrupted";
    return Object.values(thread.cancels).includes("stopping") ? "known-live" : "settled";
  }

  async function capabilities(): Promise<RuntimeCapabilities> {
    return fakeCapabilities();
  }

  function settle(): void {
    for (const thread of Object.values(state.threads)) {
      for (const operationId of Object.keys(thread.cancels)) thread.cancels[operationId] = "stopped";
    }
  }

  return {
    executor,
    admit,
    inspect,
    observe,
    cancel,
    reconcile,
    capabilities,
    settle,
    bumpEpoch: () => {
      state.epoch += 1;
    },
    snapshot: () => structuredClone(state),
    restartFrom: (snapshot) => buildFake(options, structuredClone(snapshot as FakeState)),
  };
}
