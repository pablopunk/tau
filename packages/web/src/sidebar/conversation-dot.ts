import type { ConversationSummary } from "@tau/protocol";
import type { StatusDotStatus } from "@/components/ui/status-dot";
import { preferences } from "@/lib/preferences";

const isUnseen = (conversation: ConversationSummary, nodeId?: string): boolean => {
  if (conversation.lastRunEndedAt === null) return false;
  const seenAt =
    preferences.getLastSeenAt(conversation.id, nodeId) ?? preferences.getSeenBaseline(Date.now(), nodeId);
  return conversation.lastRunEndedAt > seenAt;
};

export function conversationDot(
  conversation: ConversationSummary,
  open: boolean,
  nodeId?: string,
): StatusDotStatus | null {
  if (conversation.status === "running") return "running";
  if (conversation.status === "error") return "error";
  return !open && !conversation.parentId && isUnseen(conversation, nodeId) ? "unseen" : null;
}
