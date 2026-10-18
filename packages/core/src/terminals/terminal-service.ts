import { AppError, type ConversationSummary, type Core } from "@tau/protocol";
import type { ChangeEmitter } from "../change-emitter";
import type { TerminalDaemon } from "../harness/terminal-daemon";

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
}

const unavailable = () => new AppError("not_found", "Terminals are not available.");

/**
 * Foundation stub (owner A fills it): reports unavailable and rejects `not_found`.
 * Owner A: service, ring buffer and mode tracker, replay, repaint, size owner, cwdOf, env allow-list. Rules to keep:
 * - Ring start: when the ring first evicts bytes it advances to the first `\n` or `ESC` and skips UTF-8 continuation bytes.
 * - Ring is a chunk list that drops from the front (onData chunks are tiny: median 6 bytes), never a copy per chunk.
 * - Repaint: on the new size owner's first `resize`, a different size raises SIGWINCH by itself; an equal size with
 *   `foreground()` defined resizes to `cols + 1` and back (a same-size resize sends nothing).
 * - `cwdOf`: unknown thread `not_found`; `state === "removed"` then a missing folder `invalid_request`.
 * - Title is `foreground().name ?? shell name`.
 */
export function createTerminalService(deps: TerminalServiceDeps): TerminalService {
  return {
    api: {
      available: async () => false,
      list: async () => [],
      open: async () => Promise.reject(unavailable()),
      close: async () => Promise.reject(unavailable()),
      attach: async () => Promise.reject(unavailable()),
    },
    closeAllOf: async () => undefined,
    onConversationRemoved: async () => undefined,
    close: () => deps.daemon.close(),
  };
}
