import { AppError, unmergedKindsOf, unmergedWarningFor } from "@tau/protocol";
import type { ConversationRemoval } from "../conversation-removal";
import type { RemovalHooks } from "../removal-hooks";
import type { ConversationStore } from "./conversation-store";

export interface SubagentRemover {
  /** `has_unmerged_work` for a worktree with work that only the thread holds, unless `force`. */
  remove(id: string, force: boolean): Promise<void>;
}

export function createSubagentRemover(deps: {
  conversations: ConversationStore;
  hooks: RemovalHooks;
  removal: ConversationRemoval;
}): SubagentRemover {
  const { conversations, hooks, removal } = deps;
  return {
    async remove(id, force) {
      const summary = await conversations.find(id);
      if (summary && !force) {
        const lost = await hooks.unmergedWork(summary);
        if (lost.length > 0) {
          throw new AppError(
            "has_unmerged_work",
            unmergedWarningFor(summary.workspace.branch, unmergedKindsOf(lost)),
          );
        }
      }
      await removal.remove(id, force);
    },
  };
}
