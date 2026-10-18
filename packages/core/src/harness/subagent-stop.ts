import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import { AppError } from "@tau/protocol";
import type { ConversationStore } from "./conversation-store";
import { BACKGROUND } from "./open";
import { setStopRequested } from "./subagent-status";

export interface SubagentStopper {
  /** Sets `stopRequested` in the registry doc, then aborts the child. `invalid_request` for a thread that is not a child. */
  stop(id: string): Promise<void>;
}

export function createSubagentStopper(conversations: ConversationStore, harness: Harness): SubagentStopper {
  return {
    async stop(id) {
      const child = await conversations.find(id);
      if (!child) throw new AppError("not_found", "Conversation not found.");
      if (child.parentId === null) throw new AppError("invalid_request", "Only a subagent can be stopped.");
      const parentId = Number(child.parentId) as ConversationId;
      await harness.commit((tx) => setStopRequested(tx, parentId, id, true), BACKGROUND);
      await conversations.abort(id);
    },
  };
}
