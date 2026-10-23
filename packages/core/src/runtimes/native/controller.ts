import { randomUUID } from "node:crypto";
import { AppError, type ReconcileOutcome, type RuntimeLifecycle } from "@tau/protocol";
import type { InboxItem } from "../../harness/runtime-docs";
import type { RuntimeStore, SettleOutcome } from "../../harness/runtime-store";
import {
  type ProcessIdentity,
  type StopOptions,
  type SupervisedHandle,
  type SupervisorDeps,
  stopSupervised,
} from "../supervisor";
import type { NativeEvent } from "./events";
import { createSpawnBridge, type Launch, launchDetached, type SpawnBridge } from "./launch";
import {
  buildNativeOptions,
  DEFAULT_SETTING_SOURCES,
  type NativeSettingSource,
  type OptionsContext,
  settingSourcesNotice,
  sourcesOf,
} from "./native-options";
import { createNormalizerState, normalizeSdkMessage } from "./normalize";
import type { NativePermissionBroker } from "./permissions";
import { reconcileNative } from "./reconcile";
import { resolveSupervisorDeps, toStoredIdentity } from "./supervised-spawn";

export type NativeQuery = AsyncIterable<unknown> & {
  interrupt?(): Promise<unknown>;
  close?(): void;
};
export type NativeQueryFn = (args: { prompt: string; options: Record<string, unknown> }) => NativeQuery;
export type PrepareResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };
export type { OptionsContext };

export interface NativeControllerDeps {
  readonly store: RuntimeStore;
  readonly query: NativeQueryFn;
  readonly cwd: string;
  readonly buildOptions?: (ctx: OptionsContext) => Record<string, unknown>;
  /** Which Claude Code settings the default options load. Tests pass `[]`. */
  readonly settingSources?: readonly NativeSettingSource[];
  readonly permissions?: NativePermissionBroker;
  readonly launch?: Launch;
  /** Runs before the SDK is initialised; receives the queued message the run would deliver. */
  readonly prepare?: (item: InboxItem) => Promise<PrepareResult>;
  readonly supervisor?: Partial<SupervisorDeps>;
  readonly stop?: StopOptions;
  readonly interruptGraceMs?: number;
  readonly newId?: () => string;
  readonly now?: () => number;
}

export type SettledRun = {
  readonly status: "settled";
  readonly operationId: string;
  readonly outcome: SettleOutcome;
  readonly reason?: string;
};

export type RunResult = { readonly status: "blocked"; readonly reason: string } | SettledRun;

export interface NativeController {
  runNext(threadId: string): Promise<RunResult>;
  cancel(threadId: string, operationId: string): Promise<SettleOutcome>;
  reconcile(threadId: string): Promise<ReconcileOutcome>;
}

const STARTABLE: readonly (RuntimeLifecycle | undefined)[] = ["accepted", "blocked", "preparing", "ready"];
const DEFAULT_INTERRUPT_GRACE_MS = 1500;
const DEFAULT_VERIFY_TIMEOUT_MS = 3000;
const DEFAULT_POLL_MS = 25;

const invalidRequest = (message: string): AppError => new AppError("invalid_request", message);
const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const noop = (): void => {};

function assertNeverBypassing(options: Record<string, unknown>): void {
  if (options.permissionMode === "bypassPermissions" || options.allowDangerouslySkipPermissions === true) {
    throw invalidRequest("Native runs never bypass permissions.");
  }
}

interface ActiveRun {
  operationId?: string;
  intentRecorded?: boolean;
  bridge?: SpawnBridge;
  query?: NativeQuery;
  cancelRequested: boolean;
  cancelling?: Promise<void>;
  settingSources: readonly string[];
  result?: Extract<NativeEvent, { type: "result" }>;
}

type StartOutcome =
  | { readonly started: NativeQuery }
  | { readonly failure: unknown }
  | { readonly cancelledBeforeLaunch: true };

type Death = { readonly kind: "dead" } | { readonly kind: "unknown"; readonly reason: string };

const sessionIdOf = (message: unknown): string | undefined => {
  const id = (message as { session_id?: unknown } | null)?.session_id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
};

export function createNativeController(deps: NativeControllerDeps): NativeController {
  const { store } = deps;
  const supervisor = resolveSupervisorDeps(deps.supervisor);
  const launch = deps.launch ?? launchDetached;
  const newId = deps.newId ?? randomUUID;
  const now = deps.now ?? Date.now;
  const settingSources = deps.settingSources ?? DEFAULT_SETTING_SOURCES;
  const buildOptions =
    deps.buildOptions ??
    ((ctx: OptionsContext) =>
      buildNativeOptions({
        ...ctx,
        settingSources,
        ...(deps.permissions && { canUseTool: deps.permissions.canUseTool }),
      }));
  const prepare = deps.prepare ?? (async () => ({ ok: true as const }));
  const interruptGraceMs = deps.interruptGraceMs ?? DEFAULT_INTERRUPT_GRACE_MS;
  let active: ActiveRun | undefined;

  const assertThread = (threadId: string): void => {
    if (threadId !== store.threadId) throw invalidRequest(`This controller serves thread ${store.threadId}.`);
  };

  const notice = (key: string, code: string, text: string): Promise<unknown> =>
    store.appendEvent({ type: "notice", key, code, text });

  async function assertStartable(): Promise<RuntimeLifecycle | undefined> {
    const { lifecycle, operation } = await store.operationState();
    if (operation && !operation.terminal)
      throw invalidRequest(`Operation ${operation.operationId} is unresolved.`);
    if (!STARTABLE.includes(lifecycle)) {
      throw invalidRequest(`A thread in lifecycle ${lifecycle ?? "none"} cannot start a native run.`);
    }
    return lifecycle;
  }

  async function oldestQueued(): Promise<InboxItem> {
    const [oldest] = await store.pending();
    if (!oldest) throw invalidRequest("No queued message to run.");
    return oldest;
  }

  async function prepared(item: InboxItem): Promise<PrepareResult> {
    try {
      return await prepare(item);
    } catch (error) {
      return { ok: false, reason: describeError(error) };
    }
  }

  async function block(item: InboxItem, reason: string): Promise<RunResult> {
    await store.setLifecycle("blocked");
    await notice(`blocked:${item.requestId}:${now()}`, "blocked", `Run not started: ${reason}`);
    return { status: "blocked", reason };
  }

  async function terminalOf(): Promise<SettledRun> {
    const { operation } = await store.operationState();
    const terminal = operation?.terminal;
    if (!operation || !terminal) throw invalidRequest("The operation is not settled.");
    return {
      status: "settled",
      operationId: operation.operationId,
      outcome: terminal.lifecycle as SettleOutcome,
      ...(terminal.reason !== undefined && { reason: terminal.reason }),
    };
  }

  async function settleUnknown(run: ActiveRun, reason: string): Promise<void> {
    await store.settle("outcome-unknown", reason);
    await notice(`unknown:${run.operationId}`, "outcome-unknown", `Outcome unknown: ${reason}`);
  }

  async function verifyDeath(run: ActiveRun): Promise<Death> {
    const child = run.bridge?.child();
    if (!child) return { kind: "dead" };
    const identity = await run.bridge?.identityCommitted()?.catch(() => undefined);
    if (!identity) return waitForExit(run);
    const handle: SupervisedHandle = {
      child,
      identity,
      exited: (run.bridge?.exited() ?? Promise.resolve()).then(() => ({ code: null, signal: null })),
    };
    const stopped = await stopSupervised(handle, deps.stop, supervisor);
    if (stopped.outcome === "unknown") return { kind: "unknown", reason: stopped.reason };
    return (await groupDrained(identity))
      ? { kind: "dead" }
      : { kind: "unknown", reason: "the process group was still alive after verification" };
  }

  function groupExists(identity: ProcessIdentity): boolean {
    if (identity.pgid !== identity.pid) return false;
    try {
      supervisor.sendSignal(-identity.pgid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  async function groupDrained(identity: ProcessIdentity): Promise<boolean> {
    const deadline = Date.now() + (deps.stop?.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS);
    while (groupExists(identity)) {
      if (Date.now() > deadline) return false;
      await sleep(deps.stop?.pollMs ?? DEFAULT_POLL_MS);
    }
    return true;
  }

  async function waitForExit(run: ActiveRun): Promise<Death> {
    const exited = run.bridge?.exited();
    const verdict = await Promise.race([
      exited?.then(() => "dead"),
      sleep(deps.stop?.verifyTimeoutMs ?? 3000),
    ]);
    return verdict === "dead"
      ? { kind: "dead" }
      : { kind: "unknown", reason: "process identity was never recorded" };
  }

  async function stopInProcess(run: ActiveRun): Promise<Death> {
    await Promise.race([run.query?.interrupt?.().catch(noop), sleep(interruptGraceMs)]);
    return verifyDeath(run);
  }

  async function performCancel(run: ActiveRun): Promise<void> {
    const death = await stopInProcess(run);
    closeQuery(run);
    deps.permissions?.denyAll();
    if (death.kind === "dead") return store.settleCancels("stopped");
    await store.settleCancels("unknown", death.reason);
    await notice(`unknown:${run.operationId}`, "outcome-unknown", `Outcome unknown: ${death.reason}`);
  }

  function closeQuery(run: ActiveRun): void {
    try {
      run.query?.close?.();
    } catch {
      /* the query is already closed */
    }
  }

  async function cancelOutcome(): Promise<SettleOutcome> {
    return (await terminalOf()).outcome as SettleOutcome;
  }

  async function cancel(threadId: string, operationId: string): Promise<SettleOutcome> {
    assertThread(threadId);
    const run = active?.operationId === operationId ? active : undefined;
    if (run) run.cancelRequested = true;
    const { operation } = await store.operationState();
    if (operation?.operationId !== operationId) {
      if (run) run.cancelRequested = false;
      throw new AppError("not_found", `Operation ${operationId} is unknown.`);
    }
    const state = await store.recordCancel(operationId);
    if (state !== "stopping") return cancelOutcome();
    if (!run) {
      deps.permissions?.denyAll();
      await reconcileNative(store, { supervisor, ...(deps.stop && { stop: deps.stop }) });
      return cancelOutcome();
    }
    run.cancelling ??= performCancel(run);
    await run.cancelling;
    return cancelOutcome();
  }

  async function reconcile(threadId: string): Promise<ReconcileOutcome> {
    assertThread(threadId);
    if (active) return "known-live";
    deps.permissions?.denyAll();
    return reconcileNative(store, { supervisor, ...(deps.stop && { stop: deps.stop }) });
  }

  async function recordProvenance(run: ActiveRun, message: unknown): Promise<void> {
    const event = settingSourcesNotice(run.operationId ?? "unknown", run.settingSources, message);
    if (event) await store.appendEvent(event);
  }

  async function consume(run: ActiveRun, query: NativeQuery): Promise<void> {
    const normalizer = createNormalizerState();
    let running = false;
    let sessionRecorded = false;
    for await (const message of query) {
      if (run.cancelRequested) return;
      await run.bridge?.identityCommitted();
      if (!running) {
        await store.setLifecycle("running");
        running = true;
      }
      await recordProvenance(run, message);
      const sessionId = sessionIdOf(message);
      if (sessionId && !sessionRecorded) {
        await store.recordSession(sessionId);
        sessionRecorded = true;
      }
      for (const event of normalizeSdkMessage(message, normalizer)) {
        await store.appendEvent(event);
        if (event.type === "result") {
          run.result = event;
          return;
        }
      }
    }
  }

  async function drive(run: ActiveRun, query: NativeQuery): Promise<unknown> {
    try {
      await consume(run, query);
      return undefined;
    } catch (error) {
      return error;
    }
  }

  async function settleFrom(run: ActiveRun, error: unknown, death: Death): Promise<void> {
    if (death.kind === "unknown")
      return settleUnknown(run, `the process could not be verified dead: ${death.reason}`);
    if (run.result) {
      if (error !== undefined) {
        await notice(`post-result:${run.operationId}`, "post-result-error", describeError(error));
      }
      const { isError, subtype, text } = run.result;
      return isError ? store.settle("failed", text ?? subtype) : store.settle("completed");
    }
    return settleUnknown(run, error === undefined ? "the SDK ended without a result" : describeError(error));
  }

  async function conclude(run: ActiveRun, error: unknown): Promise<SettledRun> {
    if (!run.cancelRequested) {
      const death = await verifyDeath(run);
      closeQuery(run);
      try {
        await settleFrom(run, error, death);
      } catch (settleError) {
        if (!run.cancelRequested) throw settleError;
      }
    }
    await run.cancelling;
    return terminalOf();
  }

  async function startQuery(
    run: ActiveRun,
    item: InboxItem,
    options: Record<string, unknown>,
  ): Promise<NativeQuery | undefined> {
    const { sessionId } = await store.operationState();
    const operationId = newId();
    const nonce = newId();
    run.operationId = operationId;
    run.bridge = createSpawnBridge({
      launch,
      nonce,
      supervisor,
      recordIdentity: (identity) => store.recordIdentity(toStoredIdentity(identity)),
      refuseSpawn: () => run.cancelRequested,
    });
    const intent = await store.recordLaunchIntent({ operationId, nonce });
    if (intent.kind === "cancelled-before-launch") return undefined;
    run.intentRecorded = true;
    await store.markDeliveredOnce(item.requestId);
    await store.markDelivered(item.requestId);
    run.query = deps.query({
      prompt: item.text,
      options: {
        ...options,
        ...(sessionId && { resume: sessionId }),
        spawnClaudeCodeProcess: run.bridge.hook,
      },
    });
    return run.query;
  }

  async function startQueryOrFail(
    run: ActiveRun,
    item: InboxItem,
    options: Record<string, unknown>,
  ): Promise<StartOutcome> {
    try {
      const started = await startQuery(run, item, options);
      return started ? { started } : { cancelledBeforeLaunch: true };
    } catch (failure) {
      if (!run.intentRecorded) throw failure;
      return { failure };
    }
  }

  async function execute(run: ActiveRun): Promise<RunResult> {
    const item = await oldestQueued();
    const options = buildOptions({ threadId: store.threadId, cwd: deps.cwd });
    assertNeverBypassing(options);
    run.settingSources = sourcesOf(options);
    await store.beginOperation();
    const lifecycle = await assertStartable();
    if (lifecycle === "accepted" || lifecycle === "blocked") await store.setLifecycle("preparing");
    const outcome = await prepared(item);
    if (!outcome.ok) return block(item, outcome.reason);
    if (lifecycle !== "ready") await store.setLifecycle("ready");
    const start = await startQueryOrFail(run, item, {
      ...options,
      permissionMode: options.permissionMode ?? "dontAsk",
      ...(deps.permissions && { canUseTool: deps.permissions.canUseTool }),
    });
    if ("cancelledBeforeLaunch" in start) return terminalOf();
    const failure = "failure" in start ? start.failure : await drive(run, start.started);
    return conclude(run, failure);
  }

  async function runNext(threadId: string): Promise<RunResult> {
    assertThread(threadId);
    if (active) throw invalidRequest("A native run is already in progress for this thread.");
    const run: ActiveRun = { cancelRequested: false, settingSources: [] };
    active = run;
    try {
      return await execute(run);
    } finally {
      active = undefined;
      deps.permissions?.denyAll();
    }
  }

  return { runNext, cancel, reconcile };
}
