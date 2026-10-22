import {
  AppError,
  type CancelReceipt,
  type ObserveFrame,
  type ProjectionCursor,
  type ReconcileOutcome,
  type RuntimeCapabilities,
  type RuntimeLifecycle,
  type WriterState,
} from "@tau/protocol";
import { NATIVE_EXECUTOR, resetReasonOf } from "../../harness/runtime-docs";
import type { RuntimeStore, StoreInspection } from "../../harness/runtime-store";
import type { CancelRequest, RuntimeExecutor, RuntimeInspection } from "../types";

const NO_CONTROLLER = "Not supported for native Claude threads yet.";
const STEER_UNSUPPORTED = "Native steer delivery is not supported yet.";

export const NATIVE_SHELL_CAPABILITIES: RuntimeCapabilities = {
  followUp: { supported: true },
  steer: { supported: false, reason: STEER_UNSUPPORTED },
  approvals: { supported: false, reason: NO_CONTROLLER },
  compact: { supported: false, reason: NO_CONTROLLER },
  nativeFork: { supported: false, reason: NO_CONTROLLER },
  contextualHandoff: { supported: false, reason: NO_CONTROLLER },
  fileRewind: { supported: false, reason: NO_CONTROLLER },
  background: { supported: false, reason: NO_CONTROLLER },
  timers: { supported: false, reason: NO_CONTROLLER },
  delegation: { supported: false, reason: NO_CONTROLLER },
};

export type NativeShellExecutorOptions = { capabilities?: RuntimeCapabilities };

export interface NativeShellExecutor extends RuntimeExecutor {
  /** Stands in for a controller confirming that every recorded cancel intent took effect. */
  settle(): Promise<void>;
  bumpEpoch(): Promise<number>;
}

const UNOBSERVABLE_LIFECYCLES: readonly RuntimeLifecycle[] = [
  "preparing",
  "starting",
  "running",
  "outcome-unknown",
];

const UNPROVABLE_AFTER_RESTART: readonly RuntimeLifecycle[] = [
  ...UNOBSERVABLE_LIFECYCLES,
  "cancelling",
  "reconciling",
];

function writerStateOf(inspection: StoreInspection): WriterState {
  const { lifecycle, cancelsInFlight } = inspection;
  if (lifecycle === "outcome-unknown") return "unknown";
  if (cancelsInFlight > 0 || lifecycle === "cancelling") return "cancelling";
  if (lifecycle === "reconciling") return "reconciling";
  if (lifecycle !== undefined && UNOBSERVABLE_LIFECYCLES.includes(lifecycle)) return "unknown";
  return "settled";
}

function reconcileOutcomeOf(lifecycle: RuntimeLifecycle | undefined): ReconcileOutcome {
  if (lifecycle === "interrupted") return "interrupted";
  const unprovable = lifecycle !== undefined && UNPROVABLE_AFTER_RESTART.includes(lifecycle);
  return unprovable ? "outcome-unknown" : "settled";
}

export function createNativeShellExecutor(
  store: RuntimeStore,
  options: NativeShellExecutorOptions = {},
): NativeShellExecutor {
  const capabilityTable = options.capabilities ?? NATIVE_SHELL_CAPABILITIES;

  function assertOwnThread(threadId: string): void {
    if (threadId !== store.threadId) {
      throw new AppError(
        "invalid_request",
        `This executor serves thread ${store.threadId}, not ${threadId}.`,
      );
    }
  }

  async function inspect(threadId: string): Promise<RuntimeInspection> {
    assertOwnThread(threadId);
    const stored = await store.inspect();
    return {
      executor: NATIVE_EXECUTOR,
      capabilities: capabilityTable,
      lifecycle: stored.lifecycle,
      writer: writerStateOf(stored),
      unresolvedOutcomes: stored.unresolved,
      cursor: { epoch: stored.epoch, revision: stored.cursorRevision },
    };
  }

  async function* observe(threadId: string, from: ProjectionCursor | undefined): AsyncIterable<ObserveFrame> {
    assertOwnThread(threadId);
    const { cursor, frames } = await store.window();
    const reason = from === undefined ? undefined : resetReasonOf(cursor, frames, from);
    if (reason !== undefined) {
      yield { kind: "reset", cursor, reason };
      return;
    }
    for (const frame of frames) {
      if (frame.revision <= (from?.revision ?? 0)) continue;
      yield {
        kind: "update",
        cursor: { epoch: cursor.epoch, revision: frame.revision },
        count: frame.count,
      };
    }
  }

  async function cancel(req: CancelRequest): Promise<CancelReceipt> {
    assertOwnThread(req.threadId);
    const outcome = await store.recordCancel(req.operationId);
    return { operationId: req.operationId, intentRecorded: true, outcome };
  }

  async function reconcile(threadId: string, epoch: number): Promise<ReconcileOutcome> {
    assertOwnThread(threadId);
    const stored = await store.inspect();
    return epoch < stored.epoch ? "interrupted" : reconcileOutcomeOf(stored.lifecycle);
  }

  return {
    executor: NATIVE_EXECUTOR,
    admit: async (req) => {
      assertOwnThread(req.threadId);
      return store.admit(req);
    },
    inspect,
    observe,
    cancel,
    reconcile,
    capabilities: async (threadId) => {
      assertOwnThread(threadId);
      return capabilityTable;
    },
    settle: () => store.settleCancels(),
    bumpEpoch: () => store.bumpEpoch(),
  };
}
