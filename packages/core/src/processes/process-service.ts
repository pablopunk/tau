import { randomUUID } from "node:crypto";
import { AppError, type ConversationSummary, type ProcessInfo } from "@tau/protocol";
import type { Notification, NotificationSubmitter } from "../harness/notification-submitter";
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
import { type ExitDetails, type RunningProcess, spawnRunning } from "./running-process";

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
  /** Every chunk of output while the call still waits. */
  readonly onOutput: (text: string) => void;
}

export type ForegroundOutcome =
  | { readonly kind: "exited"; readonly exitCode: number | null; readonly stopRequested: boolean }
  /** The process runs on, listed and announced like one the agent started in the background. */
  | { readonly kind: "background"; readonly info: ProcessInfo };

export interface ForegroundRun {
  readonly id: string;
  readonly logPath: string;
  readonly outcome: Promise<ForegroundOutcome>;
  /** SIGTERM, SIGKILL after the grace period. */
  stop(): Promise<void>;
  /** After `exited`: forgets the run. The log stays when `keepLog`. */
  release(keepLog: boolean): Promise<void>;
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
}

export interface ProcessDeps {
  readonly home: string;
  /** Monitor events, exit notices and restart notices go through it. */
  readonly notifications?: NotificationSubmitter;
  readonly emitChange: (conversationId: string) => void;
  readonly stopGraceMs?: number;
  readonly batchMs?: number;
}

const DEFAULT_STOP_GRACE_MS = 5000;
const NAME_LIMIT = 40;

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
}

interface Attachment {
  readonly callId: string;
  readonly onOutput: (text: string) => void;
  readonly detach: (info: ProcessInfo) => void;
}

export function createProcessService(deps: ProcessDeps): ProcessService {
  const files = createProcessFiles(deps.home);
  const grace = deps.stopGraceMs ?? DEFAULT_STOP_GRACE_MS;
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
        void stopEntry(entry);
      },
    });
  };

  const armTimeout = (entry: Entry, timeoutMs: number) => {
    entry.timeout = setTimeout(() => {
      entry.timedOut = true;
      void stopEntry(entry);
    }, timeoutMs);
  };

  const announceRestart = (entry: Entry) =>
    send(entry, noticeNotification(restartNoticeText(entry.info.name), `notice:${entry.info.id}:restart`));

  function finishEntry(entry: Entry, details: ExitDetails) {
    if (entry.timeout) clearTimeout(entry.timeout);
    if (entry.batcher) return finishMonitor(entry, details);
    if (entry.notifyOnExit && !details.stopRequested) {
      send(entry, processExitNotification(entry.info, details.exitCode, details.logTail));
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

  async function stopEntry(entry: Entry) {
    const running = entry.running;
    if (!running) return;
    if (running.info.state !== "running") return;
    running.stopRequested = true;
    await terminateGroup(running.pid, grace);
    await running.exited;
    // onExit saves the final state in the background: a stop is done only once it is on disk.
    await entry.writes;
  }

  async function launch(request: StartProcessRequest, foreground?: Attachment): Promise<Entry> {
    const { conversationId, cwd, command } = request;
    await files.prepare();
    const id = randomUUID();
    const kind = request.kind ?? "process";
    const info: ProcessInfo = {
      id,
      conversationId,
      name: request.name?.trim() || command.slice(0, NAME_LIMIT),
      command,
      state: "running",
      exitCode: null,
      startedAt: Date.now(),
      urls: [],
      kind,
    };
    const entry: Entry = {
      info,
      pid: 0,
      delivery: Promise.resolve(),
      writes: Promise.resolve(),
      sequence: 0,
      notifyOnExit: request.notifyOnExit ?? true,
      ...(foreground && { foreground }),
    };
    const announce = () => {
      if (visible(entry)) deps.emitChange(conversationId);
    };
    if (kind === "monitor") entry.batcher = monitorBatcherFor(entry);
    entry.running = spawnRunning({
      info,
      cwd,
      logPath: files.logFile(id),
      ...(request.shell === undefined ? {} : { shell: request.shell }),
      ...(request.env === undefined ? {} : { env: request.env }),
      onChunk: (text) => entry.foreground?.onOutput(text),
      onUrls: () => {
        void persist(entry);
        announce();
      },
      onLine: (stream, line) => {
        if (stream === "stdout") entry.batcher?.push(line);
      },
      onExit: (exited, details) => {
        entry.info = exited;
        finishEntry(entry, details);
        void persist(entry);
        announce();
      },
    });
    entry.pid = entry.running.pid;
    entries.set(id, entry);
    if (kind === "monitor" && request.timeoutMs) armTimeout(entry, request.timeoutMs);
    await persist(entry);
    announce();
    return entry;
  }

  return {
    async start(request) {
      return infoOf(await launch(request));
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
          ...(request.shell === undefined ? {} : { shell: request.shell }),
          ...(request.env === undefined ? {} : { env: request.env }),
        },
        { callId: request.callId, onOutput: request.onOutput, detach },
      );
      const key = foregroundKey(request.conversationId, request.callId);
      foregroundEntries.set(key, entry);
      const running = entry.running as RunningProcess;
      const exited = running.exited.then(
        (): ForegroundOutcome => ({
          kind: "exited",
          exitCode: running.shellStatus ?? infoOf(entry).exitCode,
          stopRequested: running.stopRequested,
        }),
      );
      const moved = detached.then((info): ForegroundOutcome => ({ kind: "background", info }));
      const id = entry.info.id;
      return {
        id,
        logPath: files.logFile(id),
        outcome: Promise.race([exited, moved]),
        stop: () => stopEntry(entry),
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
      if (!entry || !attachment || infoOf(entry).state !== "running" || entry.running?.stopRequested) {
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
      return [...entries.values()].some(
        (entry) =>
          visible(entry) &&
          infoOf(entry).conversationId === conversationId &&
          infoOf(entry).state === "running",
      );
    },
    async logs(id, tail) {
      const entry = require(id);
      const text = entry.running ? entry.running.tail.text() : await files.readLog(id);
      return lastLines(text, tail);
    },
    async stop(id) {
      await stopEntry(require(id));
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
        };
        if (record.info.state === "running") {
          if (record.pid > 0 && groupIsAlive(record.pid)) await terminateGroup(record.pid, grace);
          entry.info = { ...record.info, state: "killed", exitCode: null };
          await persist(entry);
          if (record.info.kind === "monitor") announceRestart(entry);
        }
        entries.set(record.info.id, entry);
      }
    },
    async stopAll() {
      await Promise.all([...entries.values()].map(stopEntry));
    },
    async onConversationRemoved(conversation) {
      const owned = [...entries.values()].filter((entry) => entry.info.conversationId === conversation.id);
      await Promise.all(owned.map(stopEntry));
      for (const entry of owned) {
        entries.delete(entry.info.id);
        entry.removed = true;
        await entry.writes;
        await files.remove(entry.info.id);
      }
    },
  };
}
