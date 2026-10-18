import type { Change, ConversationView } from "@tau/protocol";

export type LiveStatus = "connecting" | "open" | "reconnecting" | "closed";

/**
 * One WebSocket for the whole app. FROZEN: workstream D implements it, workstream C only uses `onChanged`.
 * Changes to this interface go through `CONTRACT-CHANGES.md`.
 */
export interface LiveClient {
  /**
   * Calls `onView` with the conversation's current view, then with every later one, as the server's ops are applied.
   * `null` means the view is retired or the conversation is gone. Resubscribes by itself after a reconnect, which
   * delivers a fresh base view. Returns the unsubscribe function.
   */
  subscribe(conversationId: string, onView: (view: ConversationView | null) => void): () => void;
  /** The server says a resource changed: the app invalidates its queries. Returns the unsubscribe function. */
  onChanged(listener: (change: Change) => void): () => void;
  readonly status: LiveStatus;
  /** Calls `listener` whenever `status` changes. Returns the unsubscribe function. */
  onStatus(listener: (status: LiveStatus) => void): () => void;
  close(): void;
}
