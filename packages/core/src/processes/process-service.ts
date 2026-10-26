import { randomUUID } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { appendFile } from "node:fs/promises";
import {
  AppError,
  type ConversationSummary,
  DEFAULT_SANDBOX_SETTINGS,
  type ProcessInfo,
  type ProcessOrigin,
  type ResourceCommand,
  type ResourcePriority,
  type ResourceSettings,
  type ResourceSupport,
  type SandboxSettings,
} from "@tau/protocol";
import { releaseBangSlot } from "../harness/conversation-submit";
import type { Notification, NotificationSubmitter, PassiveWrite } from "../harness/notification-submitter";
import { createDeferred, type Deferred } from "./deferred";
import { type Exec, execCommand, systemdEnv } from "./governor/exec";
import type { SandboxScope, ThreadClass } from "./governor/governed";
import { createGovernor, type Governor, type Plan } from "./governor/governor";
import { memoryStopText } from "./governor/governor-text";
import type { WatchHandle } from "./governor/memory-watch";
import type { Sweep } from "./governor/ps-sweep";
import type { ResourceState } from "./governor/resource-state";
import { type ResourceSupportProbe, unitNodeId } from "./governor/resource-support";
import {
  findOnPath,
  type HostPlatform,
  hostPlatform,
  usesScope,
  type Wrapped,
  wrapCommand,
} from "./governor/wrap-command";
import { lastLines } from "./log-tail";
import { createMonitorBatcher, type MonitorBatcher } from "./monitor-batcher";
import { createProcessFiles } from "./process-files";
import { groupIsAlive, sleep, terminateGroup } from "./process-group";
import {
  BANG_TIMEOUT_LINE,
  bangExitWrite,
  monitorEventNotification,
  noisyNoticeText,
  noticeNotification,
  processExitNotification,
  restartNoticeText,
} from "./process-notifications";
import type { ExitDetails, ForegroundOutcome, ForegroundRun, StopReason } from "./process-types";
import { EXIT_TAIL_LINES, type RunningProcess, type SpawnFn, spawnRunning } from "./running-process";
import { gitReadWritePaths } from "./sandbox/git-scope";
import { isInsideRoot, resolveSandboxRoot, type TrustInput } from "./sandbox/trust-root";
import { cacheEnvAdditions, gitSshCommand, serviceUnit, stopSandboxUnit } from "./sandbox/unit";
import {
  composeOuter,
  type SandboxBinaries,
  type SandboxSupport,
  sandboxBackend,
  sandboxEnabled,
  sandboxPrefix,
} from "./sandbox/wrap";

export type { ExitDetails, ForegroundOutcome, ForegroundRun };

export interface StartProcessRequest {
  readonly conversationId: string;
  readonly cwd: string;
  readonly command: string;
  readonly name?: string;
  /** Default `process`. A monitor turns each stdout line into a notification. */
  readonly kind?: ProcessInfo["kind"];
  /** Who ran it: a bang exit appends without starting a turn. Everything else stays a follow-up. */
  readonly origin?: ProcessOrigin;
  /** Default true; a plain process tells the thread when it exits by itself. */
  readonly notifyOnExit?: boolean;
  /** Monitors only. 0 or undefined runs until stopped. Also shown if the entry times out; bang scales it for throttled scopes. */
  readonly timeoutMs?: number;
  /** Default `/bin/sh`. */
  readonly shell?: string;
  /** Set by the tool when resource control applies to this command. Unset means ungoverned. */
  readonly governed?: boolean;
  /** The calling thread's scope; picks the command's power level. Set with `governed`. */
  readonly scope?: ThreadClass;
  /**
   * The thread's real scope for sandbox planning, independent of `scope`/`governed` (resource eligibility).
   * `unknown` means the thread could not be resolved: sandboxed fail-closed when any scope is on.
   * Unset falls back to `scope`, then `main`, for direct callers.
   */
  readonly sandboxScope?: SandboxScope;
  /** Added to the environment of the process. */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Trusted sandbox root for this spawn (the thread's worktree or main
   * checkout). The integrator wires thread metadata here; when sandboxing is
   * on for the scope and no root resolves, the spawn is denied fail-closed.
   */
  readonly sandboxRoot?: string;
}

/** A command a tool call waits for, as a process the thread cannot see until the call is detached. */
export interface ForegroundRequest {
  readonly conversationId: string;
  /** The tool call that waits for it; what `background` names. */
  readonly callId: string;
  readonly cwd: string;
  readonly command: string;
  readonly shell?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Set by the tool when resource control applies to this command. Unset means ungoverned. */
  readonly governed?: boolean;
  /** The calling thread's scope; picks the command's power level. Set with `governed`. */
  readonly scope?: ThreadClass;
  /**
   * The thread's real scope for sandbox planning, independent of `scope`/`governed` (resource eligibility).
   * `unknown` means the thread could not be resolved: sandboxed fail-closed when any scope is on.
   * Unset falls back to `scope`, then `main`, for direct callers.
   */
  readonly sandboxScope?: SandboxScope;
  /** Trusted sandbox root, as on `StartProcessRequest`. */
  readonly sandboxRoot?: string;
  /** Distinguishes tool-spawned runs in exit delivery; unset preserves follow-up behavior. */
  readonly origin?: ProcessOrigin;
  /** Every chunk of output while the call still waits. */
  readonly onOutput: (text: string) => void;
}

export interface ProcessService {
  /** Spawns in its own process group; a pid file `<home>/processes/<id>.json`. */
  start(request: StartProcessRequest): Promise<ProcessInfo>;
  list(conversationId: string): Promise<ProcessInfo[]>;
  /** Runs a command the calling tool call waits for; `background` lets the call go without stopping it. */
  runForeground(request: ForegroundRequest): Promise<ForegroundRun>;
  /** Detaches the running foreground call; rejects `not_found` when none runs. */
  background(conversationId: string, callId: string): Promise<ProcessInfo>;
  /** True while a process or monitor of the thread runs. */
  hasRunning(conversationId: string): boolean;
  logs(id: string, tail: number): Promise<string>;
  /** SIGTERM, SIGKILL after 5 s. A bang command's kill timer stops with `timeout`. */
  stop(id: string, reason?: StopReason): Promise<void>;
  /** Hub start: kills groups left by an earlier run and marks them `killed`. */
  reapStaleAtStartup(): Promise<void>;
  /** Hub shutdown. */
  stopAll(): Promise<void>;
  /** Thread archive and delete; delete also removes the log files. */
  onConversationRemoved(conversation: ConversationSummary): Promise<void>;
  /** The node's resource settings, read synchronously. */
  resourceSettings(): ResourceSettings;
  /** Applies new settings: each scope's level to the next command. */
  setResources(next: ResourceSettings): void;
  /** Applies the sandbox switch to the next spawn. */
  setSandbox(next: SandboxSettings): void;
  /** The node's sandbox switch, read synchronously. */
  sandboxSettings(): SandboxSettings;
  /** What the host can enforce; probes the cgroup lazily on Linux. */
  resourceSupport(): Promise<ResourceSupport>;
  /** No queue: always empty. Kept so the API shape stays stable. */
  resourceActivity(): { holders: ResourceCommand[]; waiting: ResourceCommand[] };
  /** No queue: always `not_found`. Stop running commands with `stop` or `stopToolCall`. */
  stopResourceCommand(entryId: string): Promise<void>;
  /** The memory cap every governed command runs under. */
  resourceMemoryLimitMb(): number;
  /** Stops the foreground call a tool waits for; `not_found` when absent or already settled. Bounded: never hangs. */
  stopToolCall(conversationId: string, callId: string): Promise<void>;
}

export interface ProcessDeps {
  readonly home: string;
  /** Monitor events, exit notices and restart notices go through it. */
  readonly notifications?: NotificationSubmitter;
  readonly emitChange: (conversationId: string) => void;
  /** Node-wide `Change { resource: "resources" }`. */
  readonly emitResourcesChange?: () => void;
  readonly stopGraceMs?: number;
  readonly batchMs?: number;
  /** The node's resource settings; absent means Off. */
  readonly resources?: ResourceState;
  readonly nodeId?: () => string;
  /** Test seam: shrinks the memory cap so a small allocation trips it. */
  readonly memoryLimitMb?: number;
  /** Test seams: spawn, shell commands, the `ps` sweep and the support probe. */
  readonly spawn?: SpawnFn;
  readonly exec?: Exec;
  readonly sweep?: Sweep;
  readonly support?: ResourceSupportProbe;
  /** Test seam: replaces `files.prepare()`. */
  readonly prepare?: () => Promise<void>;
  /** The node's sandbox switch; absent means the staging gate (everything off, unenforced). */
  readonly sandbox?: SandboxSettings;
  /** Test seams: sandbox platform and binaries. Defaults probe the host (sandbox-exec/systemd-run/bwrap). */
  readonly sandboxPlatform?: HostPlatform;
  readonly sandboxBinaries?: SandboxBinaries;
  /** Trusted thread metadata per spawn; the integrator resolves project+workspace+worktree to a root. */
  readonly resolveSandboxRoot?: (
    conversationId: string,
  ) => TrustInput | undefined | Promise<TrustInput | undefined>;
  /** Prefer `bwrap` over the systemd service on Linux where both exist. */
  readonly preferBwrap?: boolean;
}

const DEFAULT_STOP_GRACE_MS = 5000;
/** Extra wait past the SIGTERM grace for a signalled child to reap before force-settling. */
const STOP_SETTLE_BUFFER_MS = 2000;
const NAME_LIMIT = 40;
const ACTIVE = new Set<ProcessInfo["state"]>(["running", "queued"]);

const notFound = (id: string) => new AppError("not_found", `No process ${id}`);

interface Entry {
  info: ProcessInfo;
  pid: number;
  running?: RunningProcess;
  batcher?: MonitorBatcher;
  timeout?: ReturnType<typeof setTimeout>;
  timedOut?: boolean;
  sequence: number;
  /** Notifications go out in order, one after another. */
  delivery: Promise<void>;
  /** Pid-file writes go out in order; a removed entry writes nothing more. */
  writes: Promise<void>;
  removed?: boolean;
  /** Set on exit; resolves once the entry is pruned (deleted, files removed, change emitted). */
  prune?: Promise<void>;
  /** Default true; a plain process tells the thread when it exits by itself. */
  notifyOnExit: boolean;
  /** Set while a tool call waits for the process; such a process is not listed. */
  foreground?: Attachment;
  /** A foreground call settles through this, whatever happens before or after the spawn. */
  outcome?: Deferred<ForegroundOutcome>;
  /** Settles at spawn attempt or cancel; rejects when the spawn failed and nobody waits on `outcome`. */
  spawned: Deferred<void>;
  /** Set by `stopEntry` before the spawn: nothing starts. */
  cancelled?: boolean;
  /** The exit never reaped: settled by force, still listed with its pid until the real exit prunes it. */
  reaping?: boolean;
  /** One exit notice per entry: a late real exit after a force-settle sends nothing more. */
  exitNotified?: boolean;
  /** The group survived the post-SIGKILL verify poll; named in the force-settle notice. */
  groupSurvived?: boolean;
  stopReason?: StopReason;
  /** The calling thread's scope and level, for the stop message. */
  scope?: ThreadClass;
  level?: ResourcePriority;
  /** The memory limit the command runs under, for the stop message. */
  memoryLimitMb?: number | null;
  watch?: WatchHandle;
  governed: boolean;
  timeoutMs?: number;
  wasForeground: boolean;
  /** Stable Linux service unit for this process (`tau-<nodehash>-<id>.service`); unset when unsandboxed. */
  sandboxUnit?: string;
}

interface Attachment {
  readonly callId: string;
  readonly onOutput: (text: string) => void;
  readonly detach: (info: ProcessInfo) => void;
}

interface SpawnOptions {
  readonly wrapped?: Wrapped;
  readonly scopeUnit?: string;
  readonly memoryLimitMb?: number | null;
  readonly sandbox?: SandboxPlan;
}

/** The sandbox prefix OUTSIDE the governor wrap, keyed by the resolved root. */
interface SandboxPlan {
  readonly outer: Wrapped;
  /** Set on the Linux service path: the unit tau stops/kills explicitly. */
  readonly unitId?: string;
  /** Env for the directly spawned child (service path: bus vars; the request env rides `--setenv`). */
  readonly spawnEnv?: Record<string, string>;
}

const noop = () => undefined;

const SANDBOX_SCOPES: readonly ThreadClass[] = ["main", "worktree", "subagent"];

export function createProcessService(deps: ProcessDeps): ProcessService {
  const files = createProcessFiles(deps.home);
  const grace = deps.stopGraceMs ?? DEFAULT_STOP_GRACE_MS;
  const emitResources = () => deps.emitResourcesChange?.();
  let sandboxSettings = deps.sandbox;
  const governor: Governor = createGovernor({
    graceMs: grace,
    ...(deps.memoryLimitMb !== undefined && { memoryLimitMb: deps.memoryLimitMb }),
    ...(deps.resources && { state: deps.resources }),
    ...(deps.nodeId && { nodeId: deps.nodeId }),
    ...(deps.exec && { exec: deps.exec }),
    ...(deps.sweep && { sweep: deps.sweep }),
    ...(deps.support && { support: deps.support }),
  });
  const prepareFiles = deps.prepare ?? (() => files.prepare());
  const entries = new Map<string, Entry>();
  /** Finished ids: `stop()` on one is a no-op (idempotent), unknown ids still 404. Bounded. */
  const pruned = new Map<string, string>();
  const rememberPruned = (id: string, conversationId: string) => {
    pruned.delete(id);
    pruned.set(id, conversationId);
    if (pruned.size > 500) {
      const oldest = pruned.keys().next();
      if (!oldest.done) pruned.delete(oldest.value);
    }
  };
  const foregroundKey = (conversationId: string, callId: string) => `${conversationId}\0${callId}`;
  const foregroundEntries = new Map<string, Entry>();
  const visible = (entry: Entry) => entry.foreground === undefined;

  const infoOf = (entry: Entry): ProcessInfo => entry.running?.info ?? entry.info;
  const require = (id: string): Entry => {
    const entry = entries.get(id);
    if (!entry) throw notFound(id);
    return entry;
  };
  const persist = (entry: Entry): Promise<void> => {
    // A command a tool call still waits for dies with the call; only a background process outlives a restart.
    if (entry.foreground) return entry.writes;
    entry.writes = entry.writes.then(() =>
      entry.removed ? undefined : files.save({ info: infoOf(entry), pid: entry.pid }).catch(() => undefined),
    );
    return entry.writes;
  };
  const announce = (entry: Entry) => {
    if (visible(entry)) deps.emitChange(entry.info.conversationId);
  };

  const send = (entry: Entry, notification: Notification) => {
    const conversationId = entry.info.conversationId;
    const notify = deps.notifications?.notify.bind(deps.notifications);
    if (!notify) return;
    entry.delivery = entry.delivery.then(() => notify(conversationId, notification)).catch(() => undefined);
  };

  const sendWrite = (entry: Entry, write: PassiveWrite) => {
    const conversationId = entry.info.conversationId;
    const submitWrite = deps.notifications?.submitWrite.bind(deps.notifications);
    if (!submitWrite) {
      // No harness-backed notifier: fall back so the exit still lands.
      send(entry, {
        kind: write.kind,
        data: write.data,
        text: write.text,
        requestId: write.requestId,
      });
      return;
    }
    entry.delivery = entry.delivery.then(() => submitWrite(conversationId, write)).catch(() => undefined);
  };

  const monitorBatcherFor = (entry: Entry): MonitorBatcher => {
    return createMonitorBatcher({
      batchMs: deps.batchMs,
      send: ({ lines, dropped }) =>
        send(entry, monitorEventNotification(entry.info, { lines, dropped }, entry.sequence++)),
      onNoisy: () => {
        send(entry, noticeNotification(noisyNoticeText(entry.info.name), `notice:${entry.info.id}:noisy`));
        void stopEntry(entry, "user");
      },
    });
  };

  const armTimeout = (entry: Entry, timeoutMs: number) => {
    entry.timeout = setTimeout(() => {
      entry.timedOut = true;
      void stopEntry(entry, "timeout");
    }, timeoutMs);
  };

  const announceRestartText = (name: string, id: string) =>
    noticeNotification(restartNoticeText(name), `notice:${id}:restart`);

  /** Deletes the entry and its files after the queued notifications go out. Finished processes leave no rows. */
  async function pruneEntry(entry: Entry) {
    // The one-at-a-time bang slot is held until the exit: a user stop posts
    // no exit notice but still prunes, so release on every terminal path.
    if (entry.info.origin === "bang") releaseBangSlot(entry.info.conversationId);
    entry.removed = true;
    // Bounded: a hung notifier must not hang `stop()`/`stopAll()`/shutdown forever.
    await Promise.race([entry.delivery, sleep(grace)]);
    await entry.writes;
    entries.delete(entry.info.id);
    rememberPruned(entry.info.id, entry.info.conversationId);
    await files.remove(entry.info.id).catch(() => undefined);
    deps.emitChange(entry.info.conversationId);
  }

  function finishEntry(entry: Entry, details: ExitDetails) {
    if (entry.timeout) clearTimeout(entry.timeout);
    if (entry.exitNotified) return;
    entry.exitNotified = true;
    if (entry.batcher) return finishMonitor(entry, details);
    const memoryStop = details.stopReason === "memory";
    const timeoutStop = details.stopReason === "timeout";
    if (entry.notifyOnExit && (!details.stopRequested || memoryStop || timeoutStop)) {
      const timeoutLine =
        entry.timeoutMs === undefined
          ? BANG_TIMEOUT_LINE
          : `Timed out after ${Math.round(entry.timeoutMs / 1000)} s.`;
      const tail = memoryStop
        ? `${memoryStopText(entry.memoryLimitMb ?? null, entry.scope, entry.level)}\n${details.logTail}`
        : timeoutStop
          ? `${timeoutLine}\n${details.logTail}`
          : details.logTail;
      if (entry.info.origin === "bang") {
        sendWrite(entry, bangExitWrite(entry.info, details.exitCode, tail, details.stopReason));
        return;
      }
      send(entry, processExitNotification(entry.info, details.exitCode, tail, details.stopReason));
    }
  }

  function finishMonitor(entry: Entry, details: ExitDetails) {
    const batcher = entry.batcher;
    batcher?.flush();
    batcher?.close();
    // A memory kill is not a quiet stop: the thread must learn why its monitor died.
    if (details.stopReason === "memory" && !entry.timedOut) {
      send(
        entry,
        noticeNotification(
          memoryStopText(entry.memoryLimitMb ?? null, entry.scope, entry.level),
          `notice:${entry.info.id}:memory`,
        ),
      );
    }
    if (details.stopRequested && !entry.timedOut) return;
    const ended = entry.timedOut ? "timeout" : { exitCode: details.exitCode };
    send(entry, monitorEventNotification(entry.info, { lines: [], dropped: 0, ended }, entry.sequence++));
  }

  const exitedOutcome = (entry: Entry, running: RunningProcess): ForegroundOutcome => ({
    kind: "exited",
    exitCode: running.shellStatus ?? infoOf(entry).exitCode,
    stopRequested: running.stopRequested,
    ...(running.stopReason && { stopReason: running.stopReason }),
  });

  function cancelQueued(entry: Entry, reason: StopReason) {
    if (entry.info.origin === "bang") releaseBangSlot(entry.info.conversationId);
    entry.cancelled = true;
    entry.stopReason = reason;
    if (entry.timeout) clearTimeout(entry.timeout);
    entry.info = { ...entry.info, state: "exited", exitCode: null };
    entry.outcome?.resolve({ kind: "exited", exitCode: null, stopRequested: true, stopReason: reason });
    entry.spawned.resolve();
    void persist(entry);
    announce(entry);
    emitResources();
  }

  /** The settle continuation, replicated for a child that never reaps: `running.exited.then` never runs for it. */
  function forceSettle(entry: Entry, running: RunningProcess, reason: StopReason) {
    entry.reaping = true;
    entry.watch?.stop();
    entry.watch = undefined;
    entry.outcome?.resolve({ kind: "exited", exitCode: null, stopRequested: true, stopReason: reason });
    if (entry.governed) emitResources();
    // The entry stays listed with its pid; files go only on the real exit, which notifies nothing more.
    if (entry.exitNotified) return;
    entry.exitNotified = true;
    if (entry.batcher) {
      entry.batcher.flush();
      send(
        entry,
        monitorEventNotification(
          entry.info,
          { lines: [], dropped: 0, ended: reason === "timeout" ? "timeout" : { exitCode: null } },
          entry.sequence++,
        ),
      );
      return;
    }
    if (entry.notifyOnExit)
      send(entry, processExitNotification(entry.info, null, reapingTailText(entry, running, reason), reason));
  }

  function reapingTailText(entry: Entry, running: RunningProcess, reason: StopReason): string {
    const base =
      reason === "timeout"
        ? "Timed out"
        : reason === "resources"
          ? "Stopped from Resources settings"
          : reason === "memory"
            ? memoryStopText(entry.memoryLimitMb ?? null, entry.scope, entry.level)
            : "Command aborted";
    const risk = entry.groupSurvived
      ? "The process group survived SIGKILL and may still hold resources (e.g. its port)."
      : "The process did not exit in time; it stays listed until it exits.";
    return `${base}.\n${risk}\n${lastLines(running.tail.text(), EXIT_TAIL_LINES)}`;
  }

  async function stopEntry(entry: Entry, reason: StopReason = "user") {
    if (entry.cancelled) {
      await entry.writes;
      return;
    }
    // Already force-settled: the stop settled, the real exit is still pending. Never block again.
    if (entry.reaping) return;
    const running = entry.running;
    if (!running) {
      // Not yet spawned (sync path prepares in the background): settle like a queued cancel.
      // `entry.prune` is only awaited for reaping entries that own one.
      if (entry.info.state !== "queued" && entry.info.state !== "running") {
        await entry.prune;
        return;
      }
      cancelQueued(entry, reason);
      await entry.writes;
      return;
    }
    if (running.info.state !== "running") {
      await entry.prune;
      return;
    }
    running.stopRequested = true;
    running.stopReason ??= reason;
    // The unit is manager-owned: stop it explicitly, not just the group.
    if (entry.sandboxUnit) await stopSandboxUnit(execFn, entry.sandboxUnit, "stop");
    await terminateGroup(running.pid, grace, () => {
      entry.groupSurvived = true;
    });
    const reaped = await Promise.race([
      running.exited.then(
        () => true,
        () => false,
      ),
      sleep(grace + STOP_SETTLE_BUFFER_MS).then(() => false),
    ]);
    if (reaped) {
      await entry.prune;
      return;
    }
    forceSettle(entry, running, reason);
    if (entry.sandboxUnit) await stopSandboxUnit(execFn, entry.sandboxUnit, "kill");
  }

  function createEntry(
    request: StartProcessRequest,
    foreground: Attachment | undefined,
    state: ProcessInfo["state"],
    governed: boolean,
  ): Entry {
    const { conversationId, command } = request;
    const id = randomUUID();
    const kind = request.kind ?? "process";
    const info: ProcessInfo = {
      id,
      conversationId,
      name: request.name?.trim() || command.slice(0, NAME_LIMIT),
      command,
      state,
      exitCode: null,
      startedAt: Date.now(),
      urls: [],
      kind,
      ...(request.origin === undefined ? {} : { origin: request.origin }),
    };
    const spawned = createDeferred<void>();
    spawned.promise.catch(noop);
    const entry: Entry = {
      info,
      pid: 0,
      delivery: Promise.resolve(),
      writes: Promise.resolve(),
      sequence: 0,
      notifyOnExit: request.notifyOnExit ?? true,
      spawned,
      timeoutMs: request.timeoutMs,
      governed,
      wasForeground: foreground !== undefined,
      ...(foreground && { foreground, outcome: createDeferred<ForegroundOutcome>() }),
    };
    if (kind === "monitor") entry.batcher = monitorBatcherFor(entry);
    return entry;
  }

  function spawnEntry(entry: Entry, request: StartProcessRequest, options: SpawnOptions) {
    const { cwd } = request;
    const id = entry.info.id;
    const unit = options.scopeUnit;
    const sandbox = options.sandbox;
    const baseEnv = unit === undefined ? request.env : { ...request.env, ...systemdEnv() };
    const env = sandbox?.spawnEnv ?? baseEnv;
    // Nesting order: sandbox OUTSIDE, governor (priority+memory) INSIDE.
    const inner = options.wrapped;
    const wrapped = sandbox
      ? composeOuter(sandbox.outer, inner ?? null, request.shell ?? "/bin/sh", request.command)
      : inner;
    if (sandbox?.unitId) entry.sandboxUnit = sandbox.unitId;
    const running = spawnRunning({
      info: entry.info.state === "queued" ? { ...entry.info, state: "running" } : entry.info,
      cwd,
      logPath: files.logFile(id),
      ...(request.shell === undefined ? {} : { shell: request.shell }),
      ...(env === undefined ? {} : { env }),
      ...(wrapped && { wrapped }),
      ...(deps.spawn && { spawn: deps.spawn }),
      ...(unit !== undefined && { classifyExit: () => governor.support().scopeVerdict(unit) }),
      onChunk: (text) => entry.foreground?.onOutput(text),
      onUrls: () => {
        void persist(entry);
        announce(entry);
      },
      onLine: (stream, line) => {
        if (stream === "stdout") entry.batcher?.push(line);
      },
      onExit: (exited, details) => {
        entry.info = exited;
        finishEntry(entry, details);
        if (entry.foreground) {
          void persist(entry);
          announce(entry);
          return;
        }
        // A command a tool call still waits for is invisible and owned by `release()`; prune only background rows.
        entry.prune ??= pruneEntry(entry);
      },
    });
    entry.running = running;
    entry.pid = running.pid;
    watchMemory(entry, running, options);
    void running.exited.then(() => {
      entry.watch?.rootExited();
      entry.outcome?.resolve(exitedOutcome(entry, running));
      if (entry.governed) emitResources();
    });
  }

  function watchMemory(entry: Entry, running: RunningProcess, options: SpawnOptions) {
    const limitMb = entry.governed ? (options.memoryLimitMb ?? null) : null;
    entry.memoryLimitMb = limitMb;
    if (limitMb === null || options.scopeUnit !== undefined || running.pid <= 0) return;
    if (governor.support().platform === "other") return;
    entry.watch = governor.watch().watch({
      rootPid: running.pid,
      limitMb,
      onOverLimit: () => {
        running.stopReason ??= "memory";
        running.stopRequested = true;
      },
    });
  }

  /** The command's power level: its own scope's, falling back to off. */
  function noteScope(entry: Entry, request: StartProcessRequest, plan: Plan): void {
    const scope = request.scope ?? "main";
    entry.scope = scope;
    entry.level = plan.settings.levels[scope];
  }

  function scopePriority(request: StartProcessRequest, plan: Plan): ResourcePriority {
    const scope: ThreadClass = request.scope ?? "main";
    return plan.settings.levels[scope];
  }

  function syncWrap(request: StartProcessRequest, plan: Plan | undefined): SpawnOptions {
    if (!plan) return {};
    const wrapped = wrapCommand({
      priority: scopePriority(request, plan),
      memoryLimitMb: governor.memoryLimitMb(),
      support: governor.wrapSupport(false),
      shell: request.shell ?? "/bin/sh",
      command: request.command,
    });
    return { memoryLimitMb: governor.memoryLimitMb(), ...(wrapped && { wrapped }) };
  }

  const isExecutable = (path: string) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };

  const execFn = deps.exec ?? execCommand;

  /** Host sandbox binaries, reusing the governor's resolved `systemd-run` on Linux. */
  const sandboxSupport = (): SandboxSupport => {
    const platform = deps.sandboxPlatform ?? hostPlatform();
    if (deps.sandboxBinaries) return { platform, binaries: deps.sandboxBinaries };
    if (platform === "macos") {
      return {
        platform,
        binaries: isExecutable("/usr/bin/sandbox-exec") ? { sandboxExec: "/usr/bin/sandbox-exec" } : {},
      };
    }
    if (platform === "linux") {
      const systemdRun = governor.support().binaries().systemdRun;
      const bwrap = findOnPath("bwrap");
      return {
        platform,
        binaries: { ...(systemdRun && { systemdRun }), ...(bwrap && { bwrap }) },
      };
    }
    return { platform, binaries: {} };
  };

  const sandboxNode = () => deps.nodeId?.() ?? "local";
  const sandboxUnitFor = (entryId: string) => `tau-${unitNodeId(sandboxNode())}-${entryId}`;

  const sandboxAdminPaths = (root: string, input: TrustInput): string[] => {
    if (input.adminDir && input.sharedGitDir && input.branch) {
      return gitReadWritePaths({
        worktreeRoot: root,
        adminDir: input.adminDir,
        sharedGitDir: input.sharedGitDir,
        branch: input.branch,
      }).filter((path) => path !== root);
    }
    return input.adminDir ? [input.adminDir] : [];
  };

  /**
   * The scope whose sandbox switch applies to this spawn, or `null` when none does. An unresolved thread is
   * sandboxed whenever any scope is on, under the first enabled scope: never assumed `main`.
   */
  function sandboxPolicyScope(request: StartProcessRequest, settings: SandboxSettings): ThreadClass | null {
    const requested = request.sandboxScope ?? request.scope ?? "main";
    if (requested !== "unknown") return sandboxEnabled(settings, requested) ? requested : null;
    return SANDBOX_SCOPES.find((scope) => sandboxEnabled(settings, scope)) ?? null;
  }

  /**
   * The Layer-1 sandbox plan for one spawn, keyed by the resolved root.
   * Fail-closed: sandbox on with no trusted root, a cwd outside the root, or
   * no enforcement path on this host rejects the spawn (`forbidden`) — never
   * a silent cwd substitution or an unenforced run.
   */
  async function planSandbox(request: StartProcessRequest, entryId: string): Promise<SandboxPlan | null> {
    const settings = sandboxSettings ?? DEFAULT_SANDBOX_SETTINGS;
    const scope = sandboxPolicyScope(request, settings);
    if (scope === null) return null;
    const trusted: TrustInput | undefined =
      request.sandboxRoot !== undefined
        ? { kind: "worktree", root: request.sandboxRoot }
        : await deps.resolveSandboxRoot?.(request.conversationId);
    const resolved = resolveSandboxRoot(trusted);
    if (!resolved.ok) throw new AppError("forbidden", resolved.reason);
    const root = resolved.root;
    if (!isInsideRoot(root, request.cwd)) {
      throw new AppError("forbidden", `The command runs outside the sandbox root ${root}: denied.`);
    }
    const support = sandboxSupport();
    const backend = sandboxBackend(support, deps.preferBwrap);
    if (!backend) {
      throw new AppError(
        "forbidden",
        "Sandboxing is on for this thread but unsupported on this host: denied, never silently unenforced.",
      );
    }
    const outer = sandboxPrefix({
      root,
      scope,
      settings,
      support,
      unit: sandboxUnitFor(entryId),
      workingDirectory: request.cwd,
      ...(request.env === undefined ? {} : { env: request.env }),
      adminPaths: trusted ? sandboxAdminPaths(root, trusted) : [],
      ...(deps.preferBwrap === undefined ? {} : { preferBwrap: deps.preferBwrap }),
    });
    if (!outer) {
      throw new AppError("forbidden", "Sandboxing is on but no enforcement path applies: denied.");
    }
    if (backend === "systemd") {
      // The service gets cwd+env from the unit, not the client: `--working-directory` +
      // `--setenv` ride the prefix, the client keeps only the bus variables.
      return {
        outer,
        unitId: serviceUnit(sandboxUnitFor(entryId)),
        spawnEnv: { ...request.env, ...systemdEnv() },
      };
    }
    if (backend === "seatbelt") {
      const spawnEnv = { ...cacheEnvAdditions(root), ...request.env };
      if (!spawnEnv.GIT_SSH_COMMAND) spawnEnv.GIT_SSH_COMMAND = gitSshCommand(root);
      return { outer, spawnEnv };
    }
    return { outer };
  }

  async function sandboxOption(
    request: StartProcessRequest,
    entryId: string,
  ): Promise<Pick<SpawnOptions, "sandbox"> | Record<string, never>> {
    const sandbox = await planSandbox(request, entryId);
    return sandbox ? { sandbox } : {};
  }

  async function launch(request: StartProcessRequest, foreground?: Attachment): Promise<Entry> {
    const plan = request.governed ? governor.plan() : undefined;
    if (plan?.probe) return launchAsync(request, foreground, plan);
    // The entry exists before the spawn attempt so stop works while preparing;
    // it is only registered, persisted and announced once the spawn is attempted.
    const entry = createEntry(request, foreground, "running", plan !== undefined);
    if (plan) noteScope(entry, request, plan);
    if (foreground) foregroundEntries.set(foregroundKey(request.conversationId, foreground.callId), entry);
    if (entry.info.kind === "monitor" && request.timeoutMs) armTimeout(entry, request.timeoutMs);
    void spawnSync(entry, request, plan).catch((error: unknown) => fail(entry, error, request));
    return entry;
  }

  /** The sync path's spawn attempt: prepare, then spawn unless stopped meanwhile. */
  async function spawnSync(entry: Entry, request: StartProcessRequest, plan: Plan | undefined) {
    try {
      await prepareFiles();
    } catch (error) {
      fail(entry, error, request);
      return;
    }
    if (entry.cancelled) {
      entry.spawned.resolve();
      return;
    }
    const wrapped = {
      ...syncWrap(request, plan),
      ...(await sandboxOption(request, entry.info.id)),
    };
    spawnEntry(entry, request, wrapped);
    entry.spawned.resolve();
    entries.set(entry.info.id, entry);
    await persist(entry);
    announce(entry);
  }

  /** The async path: the Linux cgroup probe runs before the spawn. */
  function launchAsync(request: StartProcessRequest, foreground: Attachment | undefined, plan: Plan): Entry {
    const entry = createEntry(request, foreground, "queued", true);
    noteScope(entry, request, plan);
    entries.set(entry.info.id, entry);
    if (foreground) foregroundEntries.set(foregroundKey(request.conversationId, foreground.callId), entry);
    void persist(entry);
    announce(entry);
    emitResources();
    void spawnNow(entry, request, plan).catch((error: unknown) => fail(entry, error, request));
    return entry;
  }

  async function spawnNow(entry: Entry, request: StartProcessRequest, plan: Plan) {
    await prepareFiles();
    const memory = plan.probe ? await governor.support().prepareMemory() : undefined;
    if (memory?.failure) throw new Error(memory.failure);
    const input = {
      priority: scopePriority(request, plan),
      memoryLimitMb: governor.memoryLimitMb(),
      support: governor.wrapSupport(memory?.cgroupMemory ?? false),
      shell: request.shell ?? "/bin/sh",
      command: request.command,
      unit: governor.support().unitFor(entry.info.id),
    };
    const wrapped = wrapCommand(input);
    if (entry.cancelled) {
      entry.spawned.resolve();
      return;
    }
    spawnEntry(entry, request, {
      memoryLimitMb: governor.memoryLimitMb(),
      ...(wrapped && { wrapped }),
      ...(usesScope(input) && { scopeUnit: input.unit }),
      ...(await sandboxOption(request, entry.info.id)),
    });
    entry.spawned.resolve();
    if (entry.info.kind === "monitor" && request.timeoutMs) armTimeout(entry, request.timeoutMs);
    await persist(entry);
    announce(entry);
    emitResources();
  }

  function fail(entry: Entry, error: unknown, request: StartProcessRequest) {
    const message = error instanceof Error ? error.message : String(error);
    if (entry.info.origin === "bang") releaseBangSlot(entry.info.conversationId);
    if (entry.cancelled) {
      entry.spawned.resolve();
      return;
    }
    entry.cancelled = true;
    // Never spawned: no pid file or listing may outlive the failure.
    entry.removed = true;
    if (entry.foreground) {
      entries.delete(entry.info.id);
      foregroundEntries.delete(foregroundKey(request.conversationId, entry.foreground.callId));
      entry.outcome?.reject(error);
      entry.spawned.resolve();
    } else if (entry.wasForeground) {
      entry.info = { ...entry.info, state: "killed", exitCode: null };
      void appendFile(files.logFile(entry.info.id), `${message}\n`).catch(noop);
      send(entry, processExitNotification(entry.info, null, message));
      entry.spawned.resolve();
      void persist(entry);
      announce(entry);
    } else {
      entries.delete(entry.info.id);
      entry.spawned.reject(error);
    }
    emitResources();
  }

  const governedOf = (request: ForegroundRequest | StartProcessRequest) => request.governed === true;

  return {
    async start(request) {
      const entry = await launch(request);
      await entry.spawned.promise;
      // The first persist runs in the background; wait for it so the pid file exists on return.
      await entry.writes;
      return infoOf(entry);
    },
    async runForeground(request) {
      let detach: (info: ProcessInfo) => void = () => undefined;
      const detached = new Promise<ProcessInfo>((resolve) => {
        detach = resolve;
      });
      const entry = await launch(
        {
          conversationId: request.conversationId,
          cwd: request.cwd,
          command: request.command,
          notifyOnExit: false,
          ...(request.origin === undefined ? {} : { origin: request.origin }),
          ...(governedOf(request) && { governed: true }),
          ...(request.scope === undefined ? {} : { scope: request.scope }),
          ...(request.sandboxScope === undefined ? {} : { sandboxScope: request.sandboxScope }),
          ...(request.shell === undefined ? {} : { shell: request.shell }),
          ...(request.env === undefined ? {} : { env: request.env }),
          ...(request.sandboxRoot === undefined ? {} : { sandboxRoot: request.sandboxRoot }),
        },
        { callId: request.callId, onOutput: request.onOutput, detach },
      );
      const key = foregroundKey(request.conversationId, request.callId);
      if (!entry.cancelled) foregroundEntries.set(key, entry);
      const exited = (entry.outcome as Deferred<ForegroundOutcome>).promise;
      const moved = detached.then((info): ForegroundOutcome => ({ kind: "background", info }));
      const id = entry.info.id;
      return {
        id,
        logPath: files.logFile(id),
        outcome: Promise.race([exited, moved]),
        admitted: entry.spawned.promise.then(noop, noop),
        stop: (reason) => stopEntry(entry, reason),
        async release(keepLog) {
          if (foregroundEntries.get(key) === entry) foregroundEntries.delete(key);
          entries.delete(id);
          entry.removed = true;
          await entry.writes;
          await (keepLog ? files.removeRecord(id) : files.remove(id));
        },
      };
    },
    async background(conversationId, callId) {
      const key = foregroundKey(conversationId, callId);
      const entry = foregroundEntries.get(key);
      const attachment = entry?.foreground;
      const state = entry ? infoOf(entry).state : undefined;
      const waiting = state === "running" || state === "queued";
      if (!entry || !attachment || !waiting || entry.cancelled || entry.running?.stopRequested) {
        throw new AppError("not_found", `No running bash call ${callId}`);
      }
      foregroundEntries.delete(key);
      delete entry.foreground;
      entry.notifyOnExit = true;
      await persist(entry);
      attachment.detach(infoOf(entry));
      deps.emitChange(conversationId);
      return infoOf(entry);
    },
    async list(conversationId) {
      return [...entries.values()]
        .filter(visible)
        .map(infoOf)
        .filter((info) => info.conversationId === conversationId);
    },
    hasRunning(conversationId) {
      return [...entries.values()].some((entry) => {
        const info = infoOf(entry);
        return visible(entry) && info.conversationId === conversationId && ACTIVE.has(info.state);
      });
    },
    /** Finished processes are pruned, so only running ones are listed. */
    async logs(id, tail) {
      const entry = require(id);
      const text = entry.running ? entry.running.tail.text() : await files.readLog(id);
      return lastLines(text, tail);
    },
    async stop(id, reason: StopReason = "user") {
      const entry = entries.get(id);
      if (entry) {
        await stopEntry(entry, reason);
        return;
      }
      if (pruned.has(id)) return;
      throw notFound(id);
    },
    async reapStaleAtStartup() {
      const notify = deps.notifications?.notify.bind(deps.notifications);
      for (const record of await files.loadAll()) {
        if (record.info.state === "running") {
          // The unit id is stable (`tau-<nodehash>-<id>.service`), so a restart
          // recomputes it and stops the manager-owned unit explicitly.
          if ((deps.sandboxPlatform ?? hostPlatform()) === "linux" && deps.nodeId) {
            await stopSandboxUnit(execFn, sandboxUnitFor(record.info.id), "stop");
          }
          if (record.pid > 0 && groupIsAlive(record.pid)) await terminateGroup(record.pid, grace);
          if (notify && record.info.kind === "monitor") {
            await notify(
              record.info.conversationId,
              announceRestartText(record.info.name, record.info.id),
            ).catch(() => undefined);
          }
        }
        rememberPruned(record.info.id, record.info.conversationId);
        await files.remove(record.info.id).catch(() => undefined);
      }
    },
    async stopAll() {
      await Promise.all([...entries.values()].map((entry) => stopEntry(entry, "user")));
    },
    async onConversationRemoved(conversation) {
      const owned = [...entries.values()].filter((entry) => entry.info.conversationId === conversation.id);
      await Promise.all(owned.map((entry) => stopEntry(entry, "user")));
      for (const entry of owned) {
        entries.delete(entry.info.id);
        entry.removed = true;
        await entry.writes;
        await files.remove(entry.info.id);
      }
      for (const [id, cid] of [...pruned]) {
        if (cid === conversation.id) pruned.delete(id);
      }
    },
    resourceSettings: () => governor.state.get(),
    resourceSupport: () => governor.support().describe(),
    setResources: (next) => governor.setResources(next),
    setSandbox: (next) => {
      sandboxSettings = next;
    },
    sandboxSettings: () => sandboxSettings ?? DEFAULT_SANDBOX_SETTINGS,
    resourceActivity() {
      return { holders: [], waiting: [] };
    },
    async stopResourceCommand(entryId) {
      throw new AppError("not_found", `No resource command ${entryId}`);
    },
    resourceMemoryLimitMb: () => governor.memoryLimitMb(),
    async stopToolCall(conversationId, callId) {
      const key = foregroundKey(conversationId, callId);
      const entry = foregroundEntries.get(key);
      const state = entry ? infoOf(entry).state : undefined;
      const waiting = state === "running" || state === "queued";
      if (!entry || !waiting || entry.cancelled || entry.reaping || entry.running?.stopRequested) {
        throw new AppError("not_found", `No running bash call ${callId}`);
      }
      await stopEntry(entry, "user");
    },
  };
}
