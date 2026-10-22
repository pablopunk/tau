import type { Harness } from "@earendil-works/pi-durable";
import {
  type AdmissionReceipt,
  AppError,
  type ConversationStatus,
  type ConversationSummary,
  type ReconcileOutcome,
  type RuntimeCapabilities,
  type RuntimeLifecycle,
  type SendMessageInput,
} from "@tau/protocol";
import type { Approvals } from "../../approvals/approvals-port";
import {
  createNativeConversation,
  isNativeConversation,
  listNativeConversations,
  type NativeStartRequest,
  type NativeThreadRef,
  recordNativeActivity,
  touchNativeConversation,
} from "../../harness/conversation-native";
import type { ConversationStore } from "../../harness/conversation-store";
import {
  createRuntimeStore,
  type OperationState,
  type RuntimeStore,
  type SettleOutcome,
} from "../../harness/runtime-store";
import type { StopOptions, SupervisorDeps } from "../supervisor";
import {
  createNativeController,
  type NativeController,
  type NativeControllerDeps,
  type NativeQueryFn,
  type RunResult,
} from "./controller";
import type { NativeRunPolicy } from "./launch-policy";
import type { NativeSettingSource } from "./native-options";
import { NATIVE_SHELL_CAPABILITIES } from "./native-shell-executor";
import { createNativePermissionBroker, type NativePermissionBroker } from "./permissions";

export interface NativeServiceDeps {
  readonly harness: Harness;
  /** Summaries and the thread's folder come from here. */
  readonly conversations: Pick<ConversationStore, "find">;
  readonly query: NativeQueryFn;
  /** The launch and prepare hooks of one thread's runs: where the sandbox decision lives. */
  readonly policyFor?: (threadId: string, cwd: string) => NativeRunPolicy;
  readonly buildOptions?: NativeControllerDeps["buildOptions"];
  /** Where a native tool call that needs the user waits. Without it every such call is denied. */
  readonly approvals?: Approvals;
  readonly permissionTimeoutMs?: number;
  readonly settingSources?: readonly NativeSettingSource[];
  readonly supervisor?: Partial<SupervisorDeps>;
  readonly stop?: StopOptions;
  readonly interruptGraceMs?: number;
  /** The sidebar of this project changed. */
  readonly onChange: (projectId: string) => void;
  readonly now?: () => number;
  readonly createStore?: (threadId: string) => RuntimeStore;
}

export type NativeCancelResult =
  | { readonly status: "idle" }
  | { readonly status: "cancel-before-launch" }
  | { readonly status: "cancelled"; readonly outcome: SettleOutcome };

export type NativeReconciled = { readonly threadId: string; readonly outcome: ReconcileOutcome };

export interface NativeService {
  /** What a native thread supports today; listed on the wire so clients never guess. */
  readonly capabilities: RuntimeCapabilities;
  startThread(request: NativeStartRequest): Promise<ConversationSummary>;
  send(threadId: string, input: SendMessageInput): Promise<AdmissionReceipt>;
  cancel(threadId: string): Promise<NativeCancelResult>;
  /** Startup only: applies persisted state to every native thread and never relaunches. */
  reconcileAll(): Promise<readonly NativeReconciled[]>;
  isNative(threadId: string): Promise<boolean>;
  /** Resolves once no pump is running. */
  settled(): Promise<void>;
  /** The thread is gone: denies what waits for the user and stops its run. */
  onConversationRemoved(threadId: string): Promise<void>;
  /** Cancels every active run, then waits for the pumps to stop. */
  close(): Promise<void>;
}

interface ThreadRuntime {
  readonly thread: NativeThreadRef;
  readonly store: RuntimeStore;
  controller: NativeController;
  permissions?: NativePermissionBroker;
  pump: Promise<void> | undefined;
  rescan: boolean;
  cancelRequested: boolean;
  gate: Promise<unknown>;
}

const STARTABLE_LIFECYCLES: readonly (RuntimeLifecycle | undefined)[] = [
  undefined,
  "accepted",
  "preparing",
  "ready",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
];

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const invalidRequest = (message: string): AppError => new AppError("invalid_request", message);

export function requireNativeInput(input: SendMessageInput): void {
  if (input.text.trim() === "") throw invalidRequest("Write a message.");
  if ((input.images ?? []).length > 0 || (input.files ?? []).length > 0) {
    throw invalidRequest("Native threads do not accept attachments yet.");
  }
}

const isUnknownAcknowledged = (state: OperationState): boolean =>
  state.lifecycle === "outcome-unknown" &&
  state.operation !== undefined &&
  state.acknowledgement?.operationId === state.operation.operationId;

const mayStartRun = (state: OperationState): boolean =>
  STARTABLE_LIFECYCLES.includes(state.lifecycle) || isUnknownAcknowledged(state);

const statusAfter = (result: RunResult): ConversationStatus =>
  result.status === "settled" && (result.outcome === "completed" || result.outcome === "cancelled")
    ? "idle"
    : "error";

const CONTINUING_OUTCOMES: readonly SettleOutcome[] = ["completed", "failed"];

const stopsPump = (result: RunResult): boolean =>
  result.status === "blocked" || !CONTINUING_OUTCOMES.includes(result.outcome);

const statusOfReconciled = (outcome: ReconcileOutcome): ConversationStatus | undefined =>
  outcome === "outcome-unknown" || outcome === "interrupted" ? "error" : undefined;

export function createNativeService(deps: NativeServiceDeps): NativeService {
  const { harness, conversations, onChange } = deps;
  const now = deps.now ?? Date.now;
  const runtimes = new Map<string, Promise<ThreadRuntime>>();
  const knownNative = new Set<string>();
  const pumps = new Set<Promise<void>>();

  async function cwdOf(threadId: string): Promise<{ cwd: string; projectId: string }> {
    const summary = await conversations.find(threadId);
    if (!summary) throw new AppError("not_found", "Conversation not found.");
    return { cwd: summary.workspace.path, projectId: summary.projectId };
  }

  function permissionsFor(runtime: ThreadRuntime, cwd: string): NativePermissionBroker | undefined {
    if (!deps.approvals) return undefined;
    const { id, projectId } = runtime.thread;
    return createNativePermissionBroker({
      approvals: deps.approvals,
      threadId: id,
      cwd,
      ...(deps.permissionTimeoutMs !== undefined && { timeoutMs: deps.permissionTimeoutMs }),
      recordNotice: (notice) => runtime.store.appendEvent(notice),
      onChange: () => onChange(projectId),
      threadExists: async () => (await conversations.find(id)) !== undefined,
    });
  }

  function controllerFor(runtime: ThreadRuntime, cwd: string): NativeController {
    const { id } = runtime.thread;
    const policy = deps.policyFor?.(id, cwd);
    const prepare: NativeControllerDeps["prepare"] = async () => {
      if (runtime.cancelRequested) return { ok: false, reason: "The run was cancelled before it started." };
      return policy ? policy.prepare() : { ok: true };
    };
    const permissions = permissionsFor(runtime, cwd);
    runtime.permissions = permissions;
    return createNativeController({
      store: runtime.store,
      query: deps.query,
      cwd,
      prepare,
      now,
      ...(permissions && { permissions }),
      ...(deps.settingSources && { settingSources: deps.settingSources }),
      ...(policy && { launch: policy.launch }),
      ...(deps.buildOptions && { buildOptions: deps.buildOptions }),
      ...(deps.supervisor && { supervisor: deps.supervisor }),
      ...(deps.stop && { stop: deps.stop }),
      ...(deps.interruptGraceMs !== undefined && { interruptGraceMs: deps.interruptGraceMs }),
    });
  }

  async function createRuntime(thread: NativeThreadRef, knownCwd?: string): Promise<ThreadRuntime> {
    const cwd = knownCwd ?? (await cwdOf(thread.id)).cwd;
    const store = (deps.createStore ?? ((id) => createRuntimeStore(harness, id, { now })))(thread.id);
    const runtime: ThreadRuntime = {
      thread,
      store,
      controller: undefined as unknown as NativeController,
      pump: undefined,
      rescan: false,
      cancelRequested: false,
      gate: Promise.resolve(),
    };
    runtime.controller = controllerFor(runtime, cwd);
    return runtime;
  }

  function runtimeOf(thread: NativeThreadRef, knownCwd?: string): Promise<ThreadRuntime> {
    const existing = runtimes.get(thread.id);
    if (existing) return existing;
    const created = createRuntime(thread, knownCwd);
    runtimes.set(thread.id, created);
    created.catch(() => runtimes.delete(thread.id));
    return created;
  }

  async function resolveThread(threadId: string): Promise<NativeThreadRef> {
    const summary = await conversations.find(threadId);
    if (!summary) throw new AppError("not_found", "Conversation not found.");
    return { id: threadId, projectId: summary.projectId };
  }

  function serialized<T>(runtime: ThreadRuntime, body: () => Promise<T>): Promise<T> {
    const result = runtime.gate.then(body, body);
    runtime.gate = result.catch(() => undefined);
    return result;
  }

  async function mirror(
    runtime: ThreadRuntime,
    status: ConversationStatus,
    endedRun: boolean,
  ): Promise<void> {
    try {
      await recordNativeActivity(harness, runtime.thread, { status, at: now(), endedRun });
      onChange(runtime.thread.projectId);
    } catch (error) {
      console.error("tau: could not record a native run on the sidebar", error);
    }
  }

  async function reportPumpError(runtime: ThreadRuntime, error: unknown): Promise<void> {
    try {
      await runtime.store.appendEvent({
        type: "notice",
        key: `pump-error:${now()}`,
        code: "pump-error",
        text: `Native run failed: ${describeError(error)}`,
      });
    } catch (noticeError) {
      console.error("tau: could not record a native pump error", error, noticeError);
    }
    await mirror(runtime, "error", true);
  }

  async function hasRunnableWork(runtime: ThreadRuntime): Promise<boolean> {
    const queued = await runtime.store.pending();
    if (queued.length === 0) return false;
    return mayStartRun(await runtime.store.operationState());
  }

  async function runOne(runtime: ThreadRuntime): Promise<boolean> {
    runtime.cancelRequested = false;
    await mirror(runtime, "running", false);
    let result: RunResult;
    try {
      result = await runtime.controller.runNext(runtime.thread.id);
    } catch (error) {
      await reportPumpError(runtime, error);
      return true;
    }
    await mirror(runtime, statusAfter(result), true);
    return stopsPump(result);
  }

  async function drain(runtime: ThreadRuntime): Promise<void> {
    try {
      for (;;) {
        runtime.rescan = false;
        const runnable = await hasRunnableWork(runtime);
        if (!runnable && !runtime.rescan) return finishPump(runtime);
        if (runnable && (await runOne(runtime))) return finishPump(runtime);
      }
    } catch (error) {
      finishPump(runtime);
      await reportPumpError(runtime, error);
    }
  }

  function finishPump(runtime: ThreadRuntime): void {
    runtime.pump = undefined;
  }

  function schedule(runtime: ThreadRuntime): Promise<void> {
    if (runtime.pump) {
      runtime.rescan = true;
      return runtime.pump;
    }
    const pump = drain(runtime).finally(() => pumps.delete(pump));
    pumps.add(pump);
    runtime.pump = pump;
    return pump;
  }

  const userPayload = (input: SendMessageInput) => ({
    text: input.text,
    attachmentIds: [],
    origin: "user" as const,
    delivery: "queue" as const,
  });

  async function admitAndSchedule(
    runtime: ThreadRuntime,
    input: SendMessageInput,
  ): Promise<AdmissionReceipt> {
    return serialized(runtime, async () => {
      const receipt = await runtime.store.admit({
        threadId: runtime.thread.id,
        requestId: input.requestId,
        payload: userPayload(input),
      });
      void schedule(runtime);
      return receipt;
    });
  }

  async function startThread(request: NativeStartRequest): Promise<ConversationSummary> {
    requireNativeInput(request.input);
    const { summary } = await createNativeConversation(harness, request);
    knownNative.add(summary.id);
    const thread = { id: summary.id, projectId: summary.projectId };
    const runtime = await runtimeOf(thread, request.workspace.path);
    await admitAndSchedule(runtime, request.input);
    onChange(thread.projectId);
    return summary;
  }

  async function send(threadId: string, input: SendMessageInput): Promise<AdmissionReceipt> {
    requireNativeInput(input);
    const thread = await resolveThread(threadId);
    const runtime = await runtimeOf(thread);
    const receipt = await admitAndSchedule(runtime, input);
    await touchNativeConversation(harness, thread, now());
    onChange(thread.projectId);
    return receipt;
  }

  async function cancel(threadId: string): Promise<NativeCancelResult> {
    const runtime = await runtimeOf(await resolveThread(threadId));
    const { operation } = await runtime.store.operationState();
    if (!operation || operation.terminal) {
      if (!runtime.pump) return { status: "idle" };
      runtime.cancelRequested = true;
      return { status: "cancel-before-launch" };
    }
    const outcome = await runtime.controller.cancel(threadId, operation.operationId);
    return { status: "cancelled", outcome };
  }

  async function reconcileOne(thread: NativeThreadRef): Promise<NativeReconciled | undefined> {
    try {
      const runtime = await runtimeOf(thread);
      const outcome = await runtime.controller.reconcile(thread.id);
      const status = statusOfReconciled(outcome);
      if (status) await mirror(runtime, status, true);
      return { threadId: thread.id, outcome };
    } catch (error) {
      console.error(`tau: could not reconcile native thread ${thread.id}`, error);
      return undefined;
    }
  }

  async function reconcileAll(): Promise<readonly NativeReconciled[]> {
    const reconciled: NativeReconciled[] = [];
    for (const thread of await listNativeConversations(harness)) {
      knownNative.add(thread.id);
      const result = await reconcileOne(thread);
      if (result) reconciled.push(result);
    }
    return reconciled;
  }

  async function isNative(threadId: string): Promise<boolean> {
    if (knownNative.has(threadId)) return true;
    const native = await isNativeConversation(harness, threadId);
    if (native) knownNative.add(threadId);
    return native;
  }

  async function settled(): Promise<void> {
    while (pumps.size > 0) await Promise.all([...pumps]);
  }

  async function onConversationRemoved(threadId: string): Promise<void> {
    const runtime = await runtimes.get(threadId)?.catch(() => undefined);
    if (!runtime) return;
    const { operation } = await runtime.store.operationState();
    if (operation && !operation.terminal) {
      await runtime.controller.cancel(threadId, operation.operationId).catch(() => undefined);
    }
    runtime.permissions?.denyAll();
  }

  async function close(): Promise<void> {
    for (const pending of runtimes.values()) {
      const runtime = await pending.catch(() => undefined);
      if (runtime?.pump) await cancel(runtime.thread.id).catch(() => undefined);
      runtime?.permissions?.denyAll();
    }
    await settled();
  }

  return {
    capabilities: NATIVE_SHELL_CAPABILITIES,
    startThread,
    send,
    cancel,
    reconcileAll,
    isNative,
    settled,
    onConversationRemoved,
    close,
  };
}
