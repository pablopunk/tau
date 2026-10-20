import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { AppError, type ConversationSummary, type ProcessInfo, type ResourceSettings, type ResourceSupport } from "@tau/protocol";
import type { Notification, NotificationSubmitter } from "../harness/notification-submitter";
import { createDeferred, type Deferred } from "./deferred";
import { createGovernor, type Governor, type Plan } from "./governor/governor";
import { memoryStopText, notStartedText, waitingForSlotText } from "./governor/governor-text";
import type { ResourceState } from "./governor/resource-state";
import type { ResourceSupportProbe } from "./governor/resource-support";
import type { SlotHandle, SlotInfo } from "./governor/slot-queue";
import type { WatchHandle } from "./governor/memory-watch";
import { type Wrapped, usesScope, wrapCommand } from "./governor/wrap-command";
import { systemdEnv, type Exec } from "./governor/exec";
import type { Sweep } from "./governor/ps-sweep";
import { lastLines } from "./log-tail";
import { createMonitorBatcher, type MonitorBatcher } from "./monitor-batcher";
import { createProcessFiles } from "./process-files";
import { groupIsAlive, terminateGroup } from "./process-group";
import {
  monitorEventNotification,
  noisyNoticeText,
  noticeNotification,
  processExitNotification,
  restartNoticeText,
} from "./process-notifications";
import type { ExitDetails, ForegroundOutcome, ForegroundRun, StopReason } from "./process-types";
import { type RunningProcess, type SpawnFn, spawnRunning } from "./running-process";

export type { ExitDetails, ForegroundOutcome, ForegroundRun };
export type { SlotInfo };

export interface StartProcessRequest {
  readonly conversationId: string;
  readonly cwd: string;
  readonly command: string;
  readonly name?: string;
  /** Default `process`. A monitor turns each stdout line into a notification. */
  readonly kind?: ProcessInfo["kind"];
  /** Default true; a plain process tells the thread when it exits by itself. */
  readonly notifyOnExit?: boolean;
  /** Monitors only. 0 or undefined runs until stopped. */
  readonly timeoutMs?: number;
  /** Default `/bin/sh`. */
  readonly shell?: string;
  /** Set by the tool when resource control applies to this command. Unset means ungoverned. */
  readonly governed?: boolean;
  /** Added to the environment of the process. */
  readonly env?: Readonly<Record<string, string>>;
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
  /** SIGTERM, SIGKILL after 5 s. */
  stop(id: string): Promise<void>;
  /** Hub start: kills groups left by an earlier run and marks them `killed`. */
  reapStaleAtStartup(): Promise<void>;
  /** Hub shutdown. */
  stopAll(): Promise<void>;
  /** Thread archive and delete; delete also removes the log files. */
  onConversationRemoved(conversation: ConversationSummary): Promise<void>;
  /** The node's resource settings, read synchronously. */
  resourceSettings(): ResourceSettings;
  /** Applies new settings: the heavy-slot limit at once, priority and memory to the next command. */
  setResources(next: ResourceSettings): void;
  /** What the host can enforce; probes the cgroup lazily on Linux. */
  resourceSupport(): Promise<ResourceSupport>;
  /** Heavy commands running and waiting, node-wide. */
  resourceActivity(): { holders: SlotInfo[]; waiting: SlotInfo[] };
  /** Stops a listed heavy command; `not_found` for anything not in `resourceActivity`. */
  stopResourceCommand(entryId: string): Promise<void>;
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
  /** Test seams: spawn, shell commands, the `ps` sweep and the support probe. */
  readonly spawn?: SpawnFn;
  readonly exec?: Exec;
  readonly sweep?: Sweep;
  readonly support?: ResourceSupportProbe;
  /** Test seam: replaces `files.prepare()`. */
  readonly prepare?: () => Promise<void>;
}

const DEFAULT_STOP_GRACE_MS = 5000;
const NAME_LIMIT = 40;
const COMMAND_LIMIT = 120;
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
  stopReason?: StopReason;
  slot?: SlotHandle;
  /** The memory limit the command runs under, for the stop message. */
  memoryLimitMb?: number | null;
  watch?: WatchHandle;
  governed: boolean;
  wasForeground: boolean;
}

interface Attachment {
  readonly callId: string;
  readonly onOutput: (text: string) => void;
  readonly detach: (info: ProcessInfo) => void;
}

interface SpawnOptions {
  readonly wrapped?: Wrapped;
  readonly scopeUnit?: string;
  readonly settings?: ResourceSettings;
}

const noop = () => undefined;
const truncate = (command: string) => command.replace(/\s+/g, " ").trim().slice(0, COMMAND_LIMIT);

export function createProcessService(deps: ProcessDeps): ProcessService {
  const files = createProcessFiles(deps.home);
  const grace = deps.stopGraceMs ?? DEFAULT_STOP_GRACE_MS;
  const emitResources = () => deps.emitResourcesChange?.();
  const governor: Governor = createGovernor({
    graceMs: grace,
    onActivity: emitResources,
    ...(deps.resources && { state: deps.resources }),
    ...(deps.nodeId && { nodeId: deps.nodeId }),
    ...(deps.exec && { exec: deps.exec }),
    ...(deps.sweep && { sweep: deps.sweep }),
    ...(deps.support && { support: deps.support }),
  });
  const prepareFiles = deps.prepare ?? (() => files.prepare());
  const entries = new Map<string, Entry>();
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

  const announceRestart = (entry: Entry) =>
    send(entry, noticeNotification(restartNoticeText(entry.info.name), `notice:${entry.info.id}:restart`));

  function finishEntry(entry: Entry, details: ExitDetails) {
    if (entry.timeout) clearTimeout(entry.timeout);
    if (entry.batcher) return finishMonitor(entry, details);
    const memoryStop = details.stopReason === "memory";
    if (entry.notifyOnExit && (!details.stopRequested || memoryStop)) {
      const tail = memoryStop
        ? `${memoryStopText(entry.memoryLimitMb ?? null)}\n${details.logTail}`
        : details.logTail;
      send(entry, processExitNotification(entry.info, details.exitCode, tail));
    }
  }

  function finishMonitor(entry: Entry, details: ExitDetails) {
    const batcher = entry.batcher;
    batcher?.flush();
    batcher?.close();
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
    entry.cancelled = true;
    entry.stopReason = reason;
    entry.slot?.cancel();
    if (entry.timeout) clearTimeout(entry.timeout);
    entry.info = { ...entry.info, state: "exited", exitCode: null };
    entry.outcome?.resolve({ kind: "exited", exitCode: null, stopRequested: true, stopReason: reason });
    entry.spawned.resolve();
    void persist(entry);
    announce(entry);
    emitResources();
  }

  async function stopEntry(entry: Entry, reason: StopReason = "user") {
    if (entry.cancelled) {
      await entry.writes;
      return;
    }
    const running = entry.running;
    if (!running) {
      if (entry.info.state !== "queued") return;
      cancelQueued(entry, reason);
      await entry.writes;
      return;
    }
    if (running.info.state !== "running") return;
    running.stopRequested = true;
    running.stopReason ??= reason;
    await terminateGroup(running.pid, grace);
    await running.exited;
    // onExit saves the final state in the background: a stop is done only once it is on disk.
    await entry.writes;
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
    const env = unit === undefined ? request.env : { ...request.env, ...systemdEnv() };
    const running = spawnRunning({
      info: entry.info.state === "queued" ? { ...entry.info, state: "running" } : entry.info,
      cwd,
      logPath: files.logFile(id),
      ...(request.shell === undefined ? {} : { shell: request.shell }),
      ...(env === undefined ? {} : { env }),
      ...(options.wrapped && { wrapped: options.wrapped }),
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
        void persist(entry);
        announce(entry);
      },
    });
    entry.running = running;
    entry.pid = running.pid;
    watchMemory(entry, running, options);
    void running.exited.then(() => {
      entry.watch?.rootExited();
      entry.slot?.release();
      entry.outcome?.resolve(exitedOutcome(entry, running));
      if (entry.governed) emitResources();
    });
  }

  function watchMemory(entry: Entry, running: RunningProcess, options: SpawnOptions) {
    const limitMb = options.settings?.memoryLimitMb ?? null;
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

  function syncWrap(request: StartProcessRequest, plan: Plan | undefined): SpawnOptions {
    if (!plan) return {};
    const wrapped = wrapCommand({
      settings: plan.settings,
      support: governor.wrapSupport(false),
      shell: request.shell ?? "/bin/sh",
      command: request.command,
    });
    return { settings: plan.settings, ...(wrapped && { wrapped }) };
  }

  async function launch(request: StartProcessRequest, foreground?: Attachment): Promise<Entry> {
    const plan = request.governed ? governor.plan(request.command, foreground !== undefined) : undefined;
    if (plan && (plan.slot || plan.probe)) return launchQueued(request, foreground, plan);
    await prepareFiles();
    const entry = createEntry(request, foreground, "running", plan !== undefined);
    spawnEntry(entry, request, syncWrap(request, plan));
    entry.spawned.resolve();
    entries.set(entry.info.id, entry);
    if (entry.info.kind === "monitor" && request.timeoutMs) armTimeout(entry, request.timeoutMs);
    await persist(entry);
    announce(entry);
    return entry;
  }

  /** The async path: register and take the slot synchronously, spawn once everything awaited is done. */
  function launchQueued(request: StartProcessRequest, foreground: Attachment | undefined, plan: Plan): Entry {
    const entry = createEntry(request, foreground, "queued", true);
    const id = entry.info.id;
    entries.set(id, entry);
    if (foreground) foregroundEntries.set(foregroundKey(request.conversationId, foreground.callId), entry);
    if (plan.slot) {
      entry.slot = governor.queue.acquire({
        entryId: id,
        conversationId: request.conversationId,
        command: truncate(request.command),
        since: Date.now(),
      });
      tellWaiting(entry, plan);
    }
    void persist(entry);
    announce(entry);
    emitResources();
    void spawnNow(entry, request, plan).catch((error: unknown) => fail(entry, error, request));
    return entry;
  }

  function tellWaiting(entry: Entry, plan: Plan) {
    const snapshot = governor.queue.snapshot();
    if (snapshot.holders.some((holder) => holder.entryId === entry.info.id)) return;
    entry.foreground?.onOutput(waitingForSlotText(snapshot.holders.length, plan.settings.heavySlots ?? 0));
  }

  async function spawnNow(entry: Entry, request: StartProcessRequest, plan: Plan) {
    if (entry.slot && !(await entry.slot.promise)) return;
    await prepareFiles();
    const memory = plan.probe ? await governor.support().prepareMemory() : undefined;
    if (memory?.failure) throw new Error(memory.failure);
    const input = {
      settings: plan.settings,
      support: governor.wrapSupport(memory?.cgroupMemory ?? false),
      shell: request.shell ?? "/bin/sh",
      command: request.command,
      unit: governor.support().unitFor(entry.info.id),
    };
    const wrapped = wrapCommand(input);
    if (entry.cancelled) {
      entry.slot?.release();
      entry.spawned.resolve();
      return;
    }
    spawnEntry(entry, request, {
      settings: plan.settings,
      ...(wrapped && { wrapped }),
      ...(usesScope(input) && { scopeUnit: input.unit }),
    });
    entry.spawned.resolve();
    if (entry.info.kind === "monitor" && request.timeoutMs) armTimeout(entry, request.timeoutMs);
    await persist(entry);
    announce(entry);
    emitResources();
  }

  function fail(entry: Entry, error: unknown, request: StartProcessRequest) {
    entry.slot?.release();
    const message = error instanceof Error ? error.message : String(error);
    if (entry.cancelled) {
      entry.spawned.resolve();
      return;
    }
    entry.cancelled = true;
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
          ...(governedOf(request) && { governed: true }),
          ...(request.shell === undefined ? {} : { shell: request.shell }),
          ...(request.env === undefined ? {} : { env: request.env }),
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
    async logs(id, tail) {
      const entry = require(id);
      const text = entry.running ? entry.running.tail.text() : await files.readLog(id);
      return lastLines(text, tail);
    },
    async stop(id) {
      await stopEntry(require(id), "user");
    },
    async reapStaleAtStartup() {
      for (const record of await files.loadAll()) {
        const entry: Entry = {
          info: record.info,
          pid: record.pid,
          delivery: Promise.resolve(),
          writes: Promise.resolve(),
          sequence: 0,
          notifyOnExit: true,
          spawned: createDeferred<void>(),
          governed: false,
          wasForeground: false,
        };
        if (record.info.state === "queued") {
          entry.info = { ...record.info, state: "killed", exitCode: null };
          await appendFile(files.logFile(record.info.id), notStartedText).catch(noop);
          await persist(entry);
        } else if (record.info.state === "running") {
          if (record.pid > 0 && groupIsAlive(record.pid)) await terminateGroup(record.pid, grace);
          entry.info = { ...record.info, state: "killed", exitCode: null };
          await persist(entry);
          if (record.info.kind === "monitor") announceRestart(entry);
        }
        entries.set(record.info.id, entry);
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
    },
    resourceSettings: () => governor.state.get(),
    resourceSupport: () => governor.support().describe(),
    setResources: (next) => governor.setResources(next),
    resourceActivity() {
      const { holders, waiting } = governor.queue.snapshot();
      return { holders: [...holders], waiting: [...waiting] };
    },
    async stopResourceCommand(entryId) {
      if (!governor.queue.has(entryId)) throw new AppError("not_found", `No resource command ${entryId}`);
      await stopEntry(require(entryId), "resources");
    },
  };
}
