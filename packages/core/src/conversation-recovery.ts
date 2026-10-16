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

export function createConversationRecovery(_deps: ConversationRecoveryDeps): ConversationRecovery {
  return {
    async recoverAtStartup() {},
  };
}
