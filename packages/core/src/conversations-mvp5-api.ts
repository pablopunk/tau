import type { Core } from "@pi-everywhere/protocol";
import type { CheckpointService } from "./checkpoints/checkpoint-service";
import type { ConversationForker } from "./harness/conversation-fork";
import type { ConversationStore } from "./harness/conversation-store";

type Mvp5Methods = "fork" | "rewindPreview" | "rewind" | "cancelQueued" | "checkpoints" | "checkpointDiff";

/** Pure delegation, so Phase 1 agents never edit `conversations-api.ts`. */
export function createConversationsMvp5Api(deps: {
  forker: ConversationForker;
  checkpoints: CheckpointService;
  conversations: ConversationStore;
}): Pick<Core["conversations"], Mvp5Methods> {
  const { forker, checkpoints, conversations } = deps;
  return {
    fork: (id, entryId) => forker.fork(id, entryId),
    rewindPreview: (id, entryId) => checkpoints.preview(id, entryId),
    rewind: (id, entryId) => checkpoints.rewind(id, entryId),
    cancelQueued: (id, itemId) => conversations.cancelQueued(id, itemId),
    checkpoints: (id) => checkpoints.list(id),
    checkpointDiff: (id, checkpointId, path) => checkpoints.diff(id, checkpointId, path),
  };
}
