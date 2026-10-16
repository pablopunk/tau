import type { Harness } from "@earendil-works/pi-durable";
import type { ChangeEmitter } from "./change-emitter";
import type { ConversationStore } from "./harness/conversation-store";

export interface ConversationRecoveryDeps {
  readonly harness: Harness;
  readonly conversations: ConversationStore;
  readonly changes: ChangeEmitter;
}

export interface ConversationRecovery {
  /** First aborts live runs of tombstoned threads, then re-submits `pendingStart` first messages. */
  recoverAtStartup(): Promise<void>;
}

export function createConversationRecovery(deps: ConversationRecoveryDeps): ConversationRecovery {
  const { conversations, changes } = deps;
  return {
    async recoverAtStartup() {
      await conversations.abortTombstonedRuns();
      for (const projectId of await conversations.resumePendingStarts()) {
        changes.emit({ resource: "conversations", projectId });
      }
    },
  };
}
