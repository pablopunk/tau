import { AppError, type Change, type Core, type ProcessInfo } from "@tau/protocol";

export const FAKE_PROCESS_URL = "http://localhost:3000";

interface Entry {
  info: ProcessInfo;
  logs: string;
}

export interface FakeProcesses {
  readonly api: Core["processes"];
  start(conversationId: string, command: string, kind?: ProcessInfo["kind"]): ProcessInfo;
  /** A command waiting for a heavy slot. Stopping it ends it as `exited` with no exit code. */
  queue(conversationId: string, command: string): ProcessInfo;
  killAll(conversationId: string): void;
}

export function createFakeProcesses(deps: {
  emit: (change: Change) => void;
  now: () => number;
}): FakeProcesses {
  const entries = new Map<string, Entry>();
  let nextId = 1;

  const entryOf = (id: string): Entry => {
    const entry = entries.get(id);
    if (!entry) throw new AppError("not_found", `Unknown process: ${id}`);
    return entry;
  };

  const kill = (entry: Entry) => {
    if (entry.info.state === "queued") {
      entry.info = { ...entry.info, state: "exited" };
      deps.emit({ resource: "processes", conversationId: entry.info.conversationId });
      return;
    }
    if (entry.info.state !== "running") return;
    entry.info = { ...entry.info, state: "killed" };
    deps.emit({ resource: "processes", conversationId: entry.info.conversationId });
  };

  const newInfo = (
    conversationId: string,
    command: string,
    kind: ProcessInfo["kind"],
    state: ProcessInfo["state"],
  ): ProcessInfo => ({
    id: `process-${nextId++}`,
    conversationId,
    name: command.split(/\s+/)[0] ?? command,
    command,
    state,
    exitCode: null,
    startedAt: deps.now(),
    urls: state === "running" ? [FAKE_PROCESS_URL] : [],
    kind,
  });

  return {
    api: {
      async list(conversationId) {
        return [...entries.values()]
          .filter((entry) => entry.info.conversationId === conversationId)
          .map((entry) => ({ ...entry.info, urls: [...entry.info.urls] }));
      },
      async logs(id, tail) {
        return entryOf(id).logs.split("\n").slice(-tail).join("\n");
      },
      async stop(id) {
        kill(entryOf(id));
      },
      async background(_conversationId, callId) {
        throw new AppError("not_found", `No running bash call ${callId}`);
      },
    },
    queue(conversationId, command) {
      const info = newInfo(conversationId, command, "process", "queued");
      entries.set(info.id, { info, logs: `$ ${command}\n` });
      deps.emit({ resource: "processes", conversationId });
      return info;
    },
    start(conversationId, command, kind = "process") {
      const info: ProcessInfo = {
        id: `process-${nextId++}`,
        conversationId,
        name: command.split(/\s+/)[0] ?? command,
        command,
        state: "running",
        exitCode: null,
        startedAt: deps.now(),
        urls: [FAKE_PROCESS_URL],
        kind,
      };
      entries.set(info.id, { info, logs: `$ ${command}\nlistening on ${FAKE_PROCESS_URL}\n` });
      deps.emit({ resource: "processes", conversationId });
      return info;
    },
    killAll(conversationId) {
      for (const entry of entries.values()) {
        if (entry.info.conversationId === conversationId) kill(entry);
      }
    },
  };
}
