import { AppError } from "@pi-everywhere/protocol";
import { notImplemented } from "../not-implemented";
import type { ConversationStore } from "./conversation-store";

export interface SubagentStopper {
  /** Sets `stopRequested` in the registry doc, then aborts the child. `invalid_request` for a thread that is not a child. */
  stop(id: string): Promise<void>;
}

export function createSubagentStopper(conversations: ConversationStore): SubagentStopper {
  return {
    async stop(id) {
      const child = await conversations.find(id);
      if (!child) throw new AppError("not_found", "Conversation not found.");
      if (child.parentId === null) throw new AppError("invalid_request", "Only a subagent can be stopped.");
      throw notImplemented("stop agent");
    },
  };
}
