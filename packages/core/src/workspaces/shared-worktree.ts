import type { ConversationSummary } from "@pi-everywhere/protocol";
import type { ConversationStore } from "../harness/conversation-store";
import { hasLiveWorktree } from "./worktree-facts";

export async function otherThreadsUsingWorktree(
  conversations: ConversationStore,
  thread: ConversationSummary,
): Promise<ConversationSummary[]> {
  if (!hasLiveWorktree(thread)) return [];
  const siblings = await conversations.list(thread.projectId).catch(() => []);
  return siblings.filter(
    (other) =>
      other.id !== thread.id &&
      other.parentId !== thread.id &&
      hasLiveWorktree(other) &&
      other.workspace.path === thread.workspace.path,
  );
}
