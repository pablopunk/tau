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
}

export interface ProcessService {
  /** Spawns in its own process group; a pid file `<home>/processes/<id>.json`. */
  start(request: StartProcessRequest): Promise<ProcessInfo>;
  list(conversationId: string): Promise<ProcessInfo[]>;
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
}

export function createProcessService(deps: ProcessDeps): ProcessService {
  const files = createProcessFiles(deps.home);
  const grace = deps.stopGraceMs ?? DEFAULT_STOP_GRACE_MS;
  const entries = new Map<string, Entry>();

  const infoOf = (entry: Entry): ProcessInfo => entry.running?.info ?? entry.info;
  const require = (id: string): Entry => {
    const entry = entries.get(id);
    if (!entry) throw notFound(id);
    return entry;
  };
  const persist = (entry: Entry) =>
    files.save({ info: infoOf(entry), pid: entry.pid }).catch(() => undefined);

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

  function finishEntry(entry: Entry, details: ExitDetails, notifyOnExit: boolean) {
    if (entry.timeout) clearTimeout(entry.timeout);
    if (entry.batcher) return finishMonitor(entry, details);
    if (notifyOnExit && !details.stopRequested) {
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
  }

  return {
    async start(request) {
      const { conversationId, cwd, command } = request;
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
      const entry: Entry = { info, pid: 0, delivery: Promise.resolve(), sequence: 0 };
      const announce = () => deps.emitChange(conversationId);
      if (kind === "monitor") entry.batcher = monitorBatcherFor(entry);
      entry.running = spawnRunning({
        info,
        cwd,
        logPath: files.logFile(id),
        onUrls: () => {
          void persist(entry);
          announce();
        },
        onLine: (stream, line) => {
          if (stream === "stdout") entry.batcher?.push(line);
        },
        onExit: (exited, details) => {
          entry.info = exited;
          finishEntry(entry, details, request.notifyOnExit ?? true);
          void persist(entry);
          announce();
        },
      });
      entry.pid = entry.running.pid;
      entries.set(id, entry);
      if (kind === "monitor" && request.timeoutMs) armTimeout(entry, request.timeoutMs);
      await persist(entry);
      announce();
      return infoOf(entry);
    },
    async list(conversationId) {
      return [...entries.values()].map(infoOf).filter((info) => info.conversationId === conversationId);
    },
    hasRunning(conversationId) {
      return [...entries.values()].some(
        (entry) => infoOf(entry).conversationId === conversationId && infoOf(entry).state === "running",
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
        const entry: Entry = { info: record.info, pid: record.pid, delivery: Promise.resolve(), sequence: 0 };
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
        await files.remove(entry.info.id);
      }
    },
  };
}
