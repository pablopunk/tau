import type { ConversationSummary } from "@tau/protocol";
import { useAllConversations } from "@/lib/queries";
import { resultDetails, type ToolCallState } from "../model/tool-state";

export function childIdOfCall(state: ToolCallState): string | undefined {
  const details = resultDetails(state);
  const id = details.conversationId ?? details.childId ?? details.id;
  return typeof id === "string" ? id : undefined;
}

export function useChildById(childId: string | undefined): ConversationSummary | undefined {
  const all = useAllConversations().data;
  return childId ? all?.find((item) => item.id === childId) : undefined;
}
