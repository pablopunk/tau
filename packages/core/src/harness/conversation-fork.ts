import type { Harness } from "@earendil-works/pi-durable";
import type { ConversationSummary } from "@pi-everywhere/protocol";
import { notImplemented } from "../not-implemented";
import type { ConversationStore } from "./conversation-store";

export interface ForkOptions {
  /** Fork just before the entry instead of at it (rewind). */
  readonly before?: boolean;
  readonly title?: string;
}

export interface ConversationForker {
  /**
   * `parent.fork(entryId, { ownership: { kind: "ownerless" }, init })`; `init` writes the ConversationDoc and the
   * index entry (workspace shared with the source, `forkOf`, title "Fork of ...") in the same commit.
   */
  fork(conversationId: string, entryId: string, options?: ForkOptions): Promise<ConversationSummary>;
}

export function createConversationForker(
  _harness: Harness,
  _conversations: ConversationStore,
): ConversationForker {
  return {
    fork: async () => {
      throw notImplemented("conversations.fork");
    },
  };
}
