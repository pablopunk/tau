import type { ConversationSummary } from "@tau/protocol";
import type { StatusDotStatus } from "@/components/ui/status-dot";
import { preferences } from "@/lib/preferences";

const isUnseen = (conversation: ConversationSummary, machineId?: string): boolean => {
  if (conversation.lastRunEndedAt === null) return false;
  const seenAt =
    preferences.getLastSeenAt(conversation.id, machineId) ??
    preferences.getSeenBaseline(Date.now(), machineId);
  return conversation.lastRunEndedAt > seenAt;
};

export function conversationDot(
  conversation: ConversationSummary,
  open: boolean,
  machineId?: string,
): StatusDotStatus | null {
  if (conversation.status === "running") return "running";
  if (conversation.status === "error") return "error";
  return !open && !conversation.parentId && isUnseen(conversation, machineId) ? "unseen" : null;
}
