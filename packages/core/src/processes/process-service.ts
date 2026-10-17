import { randomUUID } from "node:crypto";
import { AppError, type ConversationSummary, type ProcessInfo } from "@pi-everywhere/protocol";
import { lastLines } from "./log-tail";
import { createProcessFiles } from "./process-files";
import { groupIsAlive, terminateGroup } from "./process-group";
import { type RunningProcess, spawnRunning } from "./running-process";

export interface StartProcessRequest {
  readonly conversationId: string;
  readonly cwd: string;
  readonly command: string;
  readonly name?: string;
}

export interface ProcessService {
  /** Spawns in its own process group; a pid file `<home>/processes/<id>.json`. */
  start(request: StartProcessRequest): Promise<ProcessInfo>;
  list(conversationId: string): Promise<ProcessInfo[]>;
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
  readonly emitChange: (conversationId: string) => void;
  readonly stopGraceMs?: number;
}

const DEFAULT_STOP_GRACE_MS = 5000;
const NAME_LIMIT = 40;

const notFound = (id: string) => new AppError("not_found", `No process ${id}`);

interface Entry {
  info: ProcessInfo;
  pid: number;
  running?: RunningProcess;
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

  async function stopEntry(entry: Entry) {
    const running = entry.running;
    if (!running) return;
    if (running.info.state !== "running") return;
    running.stopRequested = true;
    await terminateGroup(running.pid, grace);
    await running.exited;
  }

  return {
    async start({ conversationId, cwd, command, name }) {
      const id = randomUUID();
      const info: ProcessInfo = {
        id,
        conversationId,
        name: name?.trim() || command.slice(0, NAME_LIMIT),
        command,
        state: "running",
        exitCode: null,
        startedAt: Date.now(),
        urls: [],
      };
      const entry: Entry = { info, pid: 0 };
      const announce = () => deps.emitChange(conversationId);
      entry.running = spawnRunning({
        info,
        cwd,
        logPath: files.logFile(id),
        onUrls: () => {
          void persist(entry);
          announce();
        },
        onExit: () => {
          void persist(entry);
          announce();
        },
      });
      entry.pid = entry.running.pid;
      entries.set(id, entry);
      await persist(entry);
      announce();
      return infoOf(entry);
    },
    async list(conversationId) {
      return [...entries.values()].map(infoOf).filter((info) => info.conversationId === conversationId);
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
        const entry: Entry = { info: record.info, pid: record.pid };
        if (record.info.state === "running") {
          if (record.pid > 0 && groupIsAlive(record.pid)) await terminateGroup(record.pid, grace);
          entry.info = { ...record.info, state: "killed", exitCode: null };
          await persist(entry);
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
