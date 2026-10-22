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
  type WriterState,
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
import { isUnresolved } from "../../harness/runtime-docs";
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
import {
  createNativeFinalizer,
  type NativeCheckpointPort,
  type NativeFinalizer,
  statusOfOutcome,
} from "./finalize";
import type { NativeRunPolicy } from "./launch-policy";
import { type NativeMode, retainedError } from "./native-mode";
import type { NativeSettingSource } from "./native-options";
import { NATIVE_SHELL_CAPABILITIES } from "./native-shell-executor";
import { createNativePermissionBroker, type NativePermissionBroker } from "./permissions";
import { stillPumping, writerStateOfInspection } from "./writer-state";

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
  /** Absent means checkpoints are off: nothing is snapshotted and nothing can block a run. */
  readonly checkpoints?: NativeCheckpointPort;
  /** Runs before the first native record of a new thread exists (writes the store format manifest). */
  readonly ensureFormat?: () => Promise<void>;
  readonly supervisor?: Partial<SupervisorDeps>;
  readonly stop?: StopOptions;
  readonly interruptGraceMs?: number;
  /** The sidebar of this project changed. */
  readonly onChange: (projectId: string) => void;
  readonly now?: () => number;
  readonly createStore?: (threadId: string) => RuntimeStore;
  /** `retained` refuses every start and send before any side effect; default `active`. */
  readonly mode?: Exclude<NativeMode, "off">;
  /** The shared workspace writer barrier: no run is admitted or launched into a workspace being merged or removed. */
  readonly workspaceFence?: { assertOpen(workspaceKey: string, thread: string): void };
}

export type NativeCancelResult =
  | { readonly status: "idle" }
  | { readonly status: "cancel-before-launch" }
  | { readonly status: "cancelled"; readonly outcome: SettleOutcome };

export type NativeReconciled = { readonly threadId: string; readonly outcome: ReconcileOutcome };

export interface NativeService {
  /** What a native thread supports today; listed on the wire so clients never guess. */
  readonly capabilities: RuntimeCapabilities;
  /** False in retained mode: existing native threads stay readable and cancellable, nothing new starts. */
  readonly creationEnabled: boolean;
  startThread(request: NativeStartRequest): Promise<ConversationSummary>;
  send(threadId: string, input: SendMessageInput): Promise<AdmissionReceipt>;
  cancel(threadId: string): Promise<NativeCancelResult>;
  /** Startup only: applies persisted state to every native thread and never relaunches. */
  reconcileAll(): Promise<readonly NativeReconciled[]>;
  isNative(threadId: string): Promise<boolean>;
  /** Read-only. Anything that cannot be read is `unknown`, never `settled`. */
  writerStateOf(threadId: string): Promise<WriterState>;
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

const WORKSPACE_FENCED =
  "This workspace is being changed (merge/remove). Nothing was started and your message is kept.";

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
  result.status === "settled" ? statusOfOutcome(result.outcome) : "error";

const CONTINUING_OUTCOMES: readonly SettleOutcome[] = ["completed", "failed"];

const stopsPump = (result: RunResult): boolean =>
  result.status === "blocked" || !CONTINUING_OUTCOMES.includes(result.outcome);

export function createNativeService(deps: NativeServiceDeps): NativeService {
  const { harness, conversations, onChange } = deps;
  const now = deps.now ?? Date.now;
  const creationEnabled = (deps.mode ?? "active") === "active";
  const requireCreationEnabled = (): void => {
    if (!creationEnabled) throw retainedError();
  };
  const runtimes = new Map<string, Promise<ThreadRuntime>>();
  const knownNative = new Set<string>();
  const pumps = new Set<Promise<void>>();
  const finalizer: NativeFinalizer = createNativeFinalizer({
    ...(deps.checkpoints && { checkpoints: deps.checkpoints }),
    publish: (thread, status) => mirrorThread(thread, status, true),
  });

  async function cwdOf(threadId: string): Promise<{ cwd: string; projectId: string }> {
    const summary = await conversations.find(threadId);
    if (!summary) throw new AppError("not_found", "Conversation not found.");
    return { cwd: summary.workspace.path, projectId: summary.projectId };
  }

  const isFenced = (workspaceKey: string, threadId: string): boolean => {
    try {
      deps.workspaceFence?.assertOpen(workspaceKey, threadId);
      return false;
    } catch {
      return true;
    }
  };

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
    const prepare: NativeControllerDeps["prepare"] = async (item) => {
      if (runtime.cancelRequested) return { ok: false, reason: "The run was cancelled before it started." };
      if (isFenced(cwd, id)) return { ok: false, reason: WORKSPACE_FENCED };
      const launchable = policy ? await policy.prepare() : { ok: true as const };
      if (!launchable.ok) return launchable;
      return finalizer.checkpointBefore(id, item.requestId);
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

  async function resolveSummary(threadId: string): Promise<ConversationSummary> {
    const summary = await conversations.find(threadId);
    if (!summary) throw new AppError("not_found", "Conversation not found.");
    return summary;
  }

  async function resolveThread(threadId: string): Promise<NativeThreadRef> {
    const { projectId } = await resolveSummary(threadId);
    return { id: threadId, projectId };
  }

  function serialized<T>(runtime: ThreadRuntime, body: () => Promise<T>): Promise<T> {
    const result = runtime.gate.then(body, body);
    runtime.gate = result.catch(() => undefined);
    return result;
  }

  async function mirrorThread(
    thread: NativeThreadRef,
    status: ConversationStatus,
    endedRun: boolean,
  ): Promise<void> {
    try {
      await recordNativeActivity(harness, thread, { status, at: now(), endedRun });
      onChange(thread.projectId);
    } catch (error) {
      console.error("tau: could not record a native run on the sidebar", error);
    }
  }

  const mirror = (runtime: ThreadRuntime, status: ConversationStatus, endedRun: boolean): Promise<void> =>
    mirrorThread(runtime.thread, status, endedRun);

  async function finalizeIfSettled(runtime: ThreadRuntime): Promise<void> {
    const { operation } = await runtime.store.operationState();
    const terminal = operation?.terminal;
    if (!operation || !terminal) return;
    await finalizer.finalize(runtime.thread, {
      operationId: operation.operationId,
      outcome: terminal.lifecycle as SettleOutcome,
    });
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
    if (result.status === "settled") {
      await finalizer.finalize(runtime.thread, { operationId: result.operationId, outcome: result.outcome });
    } else {
      await mirror(runtime, statusAfter(result), true);
    }
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
    requireCreationEnabled();
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
    requireCreationEnabled();
    requireNativeInput(request.input);
    deps.workspaceFence?.assertOpen(request.workspace.path, request.input.requestId);
    await deps.ensureFormat?.();
    const { summary } = await createNativeConversation(harness, request);
    knownNative.add(summary.id);
    const thread = { id: summary.id, projectId: summary.projectId };
    const runtime = await runtimeOf(thread, request.workspace.path);
    await admitAndSchedule(runtime, request.input);
    onChange(thread.projectId);
    return summary;
  }

  async function send(threadId: string, input: SendMessageInput): Promise<AdmissionReceipt> {
    requireCreationEnabled();
    requireNativeInput(input);
    const summary = await resolveSummary(threadId);
    deps.workspaceFence?.assertOpen(summary.workspace.path, threadId);
    const thread = { id: threadId, projectId: summary.projectId };
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
    await finalizeIfSettled(runtime);
    return { status: "cancelled", outcome };
  }

  async function reconcileOne(thread: NativeThreadRef): Promise<NativeReconciled | undefined> {
    try {
      const runtime = await runtimeOf(thread);
      const { operation } = await runtime.store.operationState();
      const outcome = await runtime.controller.reconcile(thread.id);
      if (isUnresolved(operation)) await finalizeIfSettled(runtime);
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

  async function writerStateOf(threadId: string): Promise<WriterState> {
    try {
      const runtime = await runtimes.get(threadId)?.catch(() => undefined);
      const store =
        runtime?.store ?? (deps.createStore ?? ((id) => createRuntimeStore(harness, id, { now })))(threadId);
      const state = writerStateOfInspection(await store.inspect());
      return stillPumping(state, runtime?.pump !== undefined);
    } catch {
      return "unknown";
    }
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
    creationEnabled,
    startThread,
    send,
    cancel,
    reconcileAll,
    isNative,
    writerStateOf,
    settled,
    onConversationRemoved,
    close,
  };
}
