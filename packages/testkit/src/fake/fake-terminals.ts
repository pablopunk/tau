import {
  AppError,
  type Change,
  type Core,
  MAX_TERMINALS_PER_THREAD,
  MAX_TERMINALS_TOTAL,
  type TerminalInfo,
} from "@tau/protocol";

const RING_BYTES = 256 * 1024;
const PROMPT = "$ ";

interface Attached {
  readonly onData: (data: Uint8Array) => void;
  readonly onExit: (exitCode: number | null) => void;
}

interface Entry {
  info: TerminalInfo;
  ring: Uint8Array;
  line: string;
  readonly attached: Set<Attached>;
}

export interface FakeTerminals {
  readonly api: Core["terminals"];
  /** Closes every terminal of the conversation (delete, archive). */
  closeAllOf(conversationId: string): void;
}

/**
 * A scripted echo shell: prints a prompt, echoes typed characters, runs `echo <text>`, and ends on `exit`.
 * New attachments get the kept output first (the ring), then live output.
 */
export function createFakeTerminals(deps: {
  emit: (change: Change) => void;
  now: () => number;
  available: boolean;
  requireConversation: (id: string) => unknown;
}): FakeTerminals {
  const entries = new Map<string, Entry>();
  const encoder = new TextEncoder();
  let nextId = 1;

  const entryOf = (id: string): Entry => {
    const entry = entries.get(id);
    if (!entry) throw new AppError("not_found", `Unknown terminal: ${id}`);
    return entry;
  };

  const announce = (entry: Entry) =>
    deps.emit({ resource: "terminals", conversationId: entry.info.conversationId });

  function emitOutput(entry: Entry, text: string) {
    const bytes = encoder.encode(text);
    const joined = new Uint8Array(entry.ring.length + bytes.length);
    joined.set(entry.ring);
    joined.set(bytes, entry.ring.length);
    entry.ring = joined.length > RING_BYTES ? joined.slice(joined.length - RING_BYTES) : joined;
    for (const client of entry.attached) client.onData(bytes);
  }

  function end(entry: Entry, exitCode: number | null) {
    if (entry.info.status === "exited") return;
    entry.info = { ...entry.info, status: "exited", exitCode };
    for (const client of [...entry.attached]) client.onExit(exitCode);
    announce(entry);
  }

  function runLine(entry: Entry, line: string) {
    const trimmed = line.trim();
    if (trimmed === "exit") return end(entry, 0);
    const output = trimmed.startsWith("echo ") ? `${trimmed.slice(5)}\r\n` : "";
    emitOutput(entry, `\r\n${output}${PROMPT}`);
  }

  function type(entry: Entry, text: string) {
    for (const char of text) {
      if (entry.info.status === "exited") return;
      if (char === "\r") {
        const line = entry.line;
        entry.line = "";
        runLine(entry, line);
      } else {
        entry.line += char;
        emitOutput(entry, char);
      }
    }
  }

  const requireAvailable = () => {
    if (!deps.available) throw new AppError("not_found", "Terminals are not available.");
  };

  return {
    api: {
      async available() {
        return deps.available;
      },
      async list(conversationId) {
        requireAvailable();
        deps.requireConversation(conversationId);
        return [...entries.values()]
          .filter((entry) => entry.info.conversationId === conversationId)
          .map((entry) => ({ ...entry.info }));
      },
      async open(conversationId) {
        requireAvailable();
        deps.requireConversation(conversationId);
        const all = [...entries.values()].filter((entry) => entry.info.status === "running");
        if (all.length >= MAX_TERMINALS_TOTAL) {
          throw new AppError("invalid_request", `At most ${MAX_TERMINALS_TOTAL} terminals are open.`);
        }
        if (
          all.filter((entry) => entry.info.conversationId === conversationId).length >=
          MAX_TERMINALS_PER_THREAD
        ) {
          throw new AppError("invalid_request", `At most ${MAX_TERMINALS_PER_THREAD} terminals per thread.`);
        }
        const info: TerminalInfo = {
          id: `terminal-${nextId++}`,
          conversationId,
          title: "sh",
          status: "running",
          exitCode: null,
          createdAt: deps.now(),
        };
        const entry: Entry = { info, ring: new Uint8Array(), line: "", attached: new Set() };
        entries.set(info.id, entry);
        emitOutput(entry, PROMPT);
        announce(entry);
        return { ...info };
      },
      async close(id) {
        const entry = entryOf(id);
        end(entry, null);
      },
      async attach(id, handlers) {
        const entry = entryOf(id);
        const client: Attached = handlers;
        if (entry.ring.length > 0) handlers.onData(entry.ring.slice());
        entry.attached.add(client);
        return {
          status: entry.info.status,
          exitCode: entry.info.exitCode,
          write: (data) => type(entry, new TextDecoder().decode(data)),
          resize: () => undefined,
          detach: () => {
            entry.attached.delete(client);
          },
        };
      },
    },
    closeAllOf(conversationId) {
      for (const entry of entries.values()) {
        if (entry.info.conversationId === conversationId) end(entry, null);
      }
    },
  };
}
