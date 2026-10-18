import type { Core } from "@tau/protocol";
import type { Approvals } from "./approvals/approvals-port";

export function createApprovalsApi(approvals: Approvals): Core["approvals"] {
  return {
    list: async (conversationId) => [...approvals.list(conversationId)],
    decide: (conversationId, toolUseId, decision) => approvals.decide(conversationId, toolUseId, decision),
  };
}
