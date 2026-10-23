import type { Change, ConversationView } from "@tau/protocol";

export type LiveStatus = "connecting" | "open" | "reconnecting" | "closed";

/**
 * One WebSocket for the whole app.
 */
export interface LiveClient {
  /**
   * Calls `onView` with the conversation's current view, then with every later one, as the server's ops are applied.
   * `null` means the view is retired or the conversation is gone. Resubscribes by itself after a reconnect, which
   * delivers a fresh base view. Returns the unsubscribe function.
   */
  subscribe(conversationId: string, onView: (view: ConversationView | null) => void): () => void;
  /**
   * The conversation's latest view when the client still holds one (it is open, or was left a moment ago and
   * kept in sync), else `undefined`. Never fetches.
   */
  peek(conversationId: string): ConversationView | undefined;
  /** Starts fetching a conversation the user is likely to open, and keeps it for a while. Idempotent and cheap. */
  warm(conversationId: string): void;
  /** The server says a resource changed: the app invalidates its queries. Returns the unsubscribe function. */
  onChanged(listener: (change: Change) => void): () => void;
  readonly status: LiveStatus;
  /** Calls `listener` whenever `status` changes. Returns the unsubscribe function. */
  onStatus(listener: (status: LiveStatus) => void): () => void;
  close(): void;
}
