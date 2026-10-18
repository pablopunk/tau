import { AppError, type Core } from "@tau/protocol";
import type { Approvals } from "./approvals/approvals-port";
import type { ConversationStore } from "./harness/conversation-store";

export function createApprovalsApi(
  approvals: Approvals,
  conversations: Pick<ConversationStore, "find">,
): Core["approvals"] {
  return {
    async list(conversationId) {
      if (!(await conversations.find(conversationId)))
        throw new AppError("not_found", "Conversation not found.");
      return [...approvals.list(conversationId)];
    },
    decide: (conversationId, toolUseId, decision) => approvals.decide(conversationId, toolUseId, decision),
  };
}
