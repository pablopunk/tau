import type { ConversationStore } from "./harness/conversation-store";
import { type RemovalHooks, requireNoLostWork, runConversationRemoved } from "./removal-hooks";

export interface ConversationRemoval {
  /** `has_unmerged_work` unless `force`. Subagent children go with their parent. Idempotent. */
  remove(id: string, force: boolean): Promise<void>;
}

export function createConversationRemoval(deps: {
  conversations: ConversationStore;
  hooks: RemovalHooks;
  now: () => number;
  announce: (projectId: string) => void;
}): ConversationRemoval {
  const { conversations, hooks, now, announce } = deps;
  return {
    async remove(id, force) {
      const summary = await conversations.find(id);
      if (summary) await requireNoLostWork(hooks, summary, force);
      const children = summary
        ? (await conversations.list(summary.projectId)).filter((thread) => thread.parentId === id)
        : [];
      const projectId = await conversations.remove(id, now());
      if (projectId === undefined) return;
      for (const child of children) {
        await conversations.remove(child.id, now());
        await runConversationRemoved(hooks, child);
      }
      if (summary) await runConversationRemoved(hooks, summary);
      announce(projectId);
    },
  };
}
