import type { ConversationSummary } from "@pi-everywhere/protocol";
import type { StatusDotStatus } from "@/components/ui/status-dot";
import { preferences } from "@/lib/preferences";

const isUnseen = (conversation: ConversationSummary): boolean => {
  if (conversation.lastRunEndedAt === null) return false;
  const seenAt = preferences.getLastSeenAt(conversation.id) ?? preferences.getSeenBaseline(Date.now());
  return conversation.lastRunEndedAt > seenAt;
};

export function conversationDot(conversation: ConversationSummary, open: boolean): StatusDotStatus | null {
  if (conversation.status === "running") return "running";
  if (conversation.status === "error") return "error";
  return !open && !conversation.parentId && isUnseen(conversation) ? "unseen" : null;
}
