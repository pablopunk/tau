import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import {
  AppError,
  type ConversationSummary,
  type Core,
  MAX_TERMINALS_PER_THREAD,
  MAX_TERMINALS_TOTAL,
} from "@tau/protocol";
import type { ChangeEmitter } from "../change-emitter";
import type { ConversationStore } from "../harness/conversation-store";
import type { TerminalDaemon } from "../harness/terminal-daemon";
import { cwdOf } from "./cwd-of";
import { attachClient, createEntry, receive, type TerminalEntry } from "./terminal-entry";
import { terminalEnvironment } from "./terminal-env";

export interface TerminalService {
  readonly api: Core["terminals"];
  /** Closes every terminal of this conversation. Keys on the id and never reads the store. Best-effort and idempotent. */
  closeAllOf(conversationId: string): Promise<void>;
  /** The `onConversationRemoved` hook: closes the thread's terminals and its children's. */
  onConversationRemoved(conversation: ConversationSummary): Promise<void>;
  /** Stops the daemon (it kills every shell). */
  close(): Promise<void>;
}

export interface TerminalServiceDeps {
  readonly daemon: TerminalDaemon;
  readonly changes: ChangeEmitter;
  /** Threads and their folders. Optional only for the foundation tests; the real core passes it. */
  readonly conversations?: Pick<ConversationStore, "find" | "list">;
  /** The tau home: `$TAU_HOME/bin` goes first on the shell's PATH. */
  readonly home?: string;
  /** Source of the environment allow-list. Default `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => number;
  readonly titleIntervalMs?: number;
}

const TITLE_INTERVAL_MS = 2000;
const notFound = (what: string) => new AppError("not_found", what);
const unavailable = () => notFound("Terminals are not available.");

export function createTerminalService(deps: TerminalServiceDeps): TerminalService {
  const entries = new Map<string, TerminalEntry>();
  /** Ids already closed and dropped: closing them again is a no-op, not `not_found`. */
  const dismissed = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setInterval>>();
  const now = deps.now ?? Date.now;
  const announce = (entry: TerminalEntry) =>
    deps.changes.emit({ resource: "terminals", conversationId: entry.info.conversationId });

  const requireAvailable = async () => {
    if (!(await deps.daemon.available())) throw unavailable();
  };
  const requireThread = async (conversationId: string) => {
    if (!deps.conversations || !(await deps.conversations.find(conversationId))) {
      throw notFound("Conversation not found.");
    }
  };
  const entryOf = (id: string) => entries.get(id) ?? Promise.reject(notFound(`No terminal ${id}`));
  const running = () => [...entries.values()].filter((entry) => entry.info.status === "running");

  function checkLimits(conversationId: string) {
    const all = running();
    if (all.length >= MAX_TERMINALS_TOTAL) {
      throw new AppError("invalid_request", `At most ${MAX_TERMINALS_TOTAL} terminals are open.`);
    }
    if (
      all.filter((entry) => entry.info.conversationId === conversationId).length >= MAX_TERMINALS_PER_THREAD
    ) {
      throw new AppError("invalid_request", `At most ${MAX_TERMINALS_PER_THREAD} terminals per thread.`);
    }
  }

  function end(entry: TerminalEntry, exitCode: number | null) {
    if (entry.info.status === "exited") return;
    entry.info = { ...entry.info, status: "exited", exitCode };
    stopTitlePolling(entry);
    for (const client of [...entry.clients]) client.handlers.onExit(exitCode);
    announce(entry);
  }

  async function refreshTitle(entry: TerminalEntry) {
    const job = await entry.port.foreground().catch(() => undefined);
    const title = job?.name ?? entry.shellName;
    if (entry.info.status !== "running" || title === entry.info.title) return;
    entry.info = { ...entry.info, title };
    announce(entry);
  }

  function stopTitlePolling(entry: TerminalEntry) {
    const timer = timers.get(entry.info.id);
    if (timer) clearInterval(timer);
    timers.delete(entry.info.id);
  }

  function pollTitleWhileAttached(entry: TerminalEntry) {
    if (timers.has(entry.info.id) || entry.info.status !== "running") return;
    const timer = setInterval(() => void refreshTitle(entry), deps.titleIntervalMs ?? TITLE_INTERVAL_MS);
    timer.unref();
    timers.set(entry.info.id, timer);
  }

  async function open(conversationId: string, size: { cols: number; rows: number }) {
    await requireAvailable();
    await requireThread(conversationId);
    const cwd = await cwdOf(deps.conversations as NonNullable<typeof deps.conversations>, conversationId);
    checkLimits(conversationId);
    const env = terminalEnvironment(deps.env ?? process.env, deps.home ?? "", conversationId);
    let entry: TerminalEntry | undefined;
    const pending: Uint8Array[] = [];
    const port = await deps.daemon.open({
      cwd,
      env,
      cols: size.cols,
      rows: size.rows,
      onData: (bytes) => (entry ? receive(entry, bytes) : pending.push(bytes)),
    });
    const info = {
      id: randomUUID(),
      conversationId,
      title: basename(env.SHELL as string),
      status: "running" as const,
      exitCode: null,
      createdAt: now(),
    };
    entry = createEntry(info, info.title, port, size.cols, size.rows);
    for (const bytes of pending) receive(entry, bytes);
    entries.set(info.id, entry);
    const created = entry;
    void port.exited.then((code) => end(created, code));
    announce(entry);
    return { ...info };
  }

  function endEntry(entry: TerminalEntry) {
    if (entry.info.status === "exited") return;
    end(entry, null);
    entry.port.close();
  }

  /** The user closed it: the shell dies and the record goes, an ended one included. */
  function closeEntry(entry: TerminalEntry) {
    endEntry(entry);
    if (entries.get(entry.info.id) !== entry) return;
    entries.delete(entry.info.id);
    dismissed.add(entry.info.id);
    announce(entry);
  }

  async function closeAllOf(conversationId: string) {
    for (const entry of [...entries.values()]) {
      if (entry.info.conversationId === conversationId) endEntry(entry);
    }
  }

  /** The thread is gone: its ended records go with it. */
  function forgetAllOf(conversationId: string) {
    for (const entry of [...entries.values()]) {
      if (entry.info.conversationId === conversationId) entries.delete(entry.info.id);
    }
  }

  async function childrenOf(conversation: ConversationSummary) {
    const threads = (await deps.conversations?.list(conversation.projectId)) ?? [];
    return threads.filter((thread) => thread.parentId === conversation.id);
  }

  return {
    api: {
      available: () => deps.daemon.available(),
      async list(conversationId) {
        await requireAvailable();
        await requireThread(conversationId);
        return [...entries.values()]
          .filter((entry) => entry.info.conversationId === conversationId)
          .map((entry) => ({ ...entry.info }));
      },
      open: (conversationId, size) => open(conversationId, size),
      async close(id) {
        if (dismissed.has(id)) return;
        closeEntry(await entryOf(id));
      },
      async attach(id, handlers) {
        const entry = await entryOf(id);
        const attachment = attachClient(entry, handlers);
        pollTitleWhileAttached(entry);
        const detach = attachment.detach;
        return {
          ...attachment,
          detach: () => {
            detach();
            if (entry.clients.length === 0) stopTitlePolling(entry);
          },
        };
      },
    },
    closeAllOf,
    async onConversationRemoved(conversation) {
      await closeAllOf(conversation.id).catch(() => undefined);
      forgetAllOf(conversation.id);
      for (const child of await childrenOf(conversation).catch(() => [])) {
        await closeAllOf(child.id);
        forgetAllOf(child.id);
      }
    },
    async close() {
      for (const entry of entries.values()) stopTitlePolling(entry);
      await deps.daemon.close();
    },
  };
}
