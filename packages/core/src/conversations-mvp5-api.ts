import type { Core } from "@tau/protocol";
import type { CheckpointService } from "./checkpoints/checkpoint-service";
import type { ConversationForker } from "./harness/conversation-fork";
import type { ConversationStore } from "./harness/conversation-store";
import type { SubagentStopper } from "./harness/subagent-stop";

type Mvp5Methods =
  | "fork"
  | "stopAgent"
  | "rewindPreview"
  | "rewind"
  | "cancelQueued"
  | "checkpoints"
  | "checkpointDiff";

/** Pure delegation, so Phase 1 agents never edit `conversations-api.ts`. */
export function createConversationsMvp5Api(deps: {
  forker: ConversationForker;
  checkpoints: CheckpointService;
  conversations: ConversationStore;
  subagents: SubagentStopper;
}): Pick<Core["conversations"], Mvp5Methods> {
  const { forker, checkpoints, conversations, subagents } = deps;
  return {
    fork: (id, entryId) => forker.fork(id, entryId),
    stopAgent: (id) => subagents.stop(id),
    rewindPreview: (id, entryId) => checkpoints.preview(id, entryId),
    rewind: (id, entryId) => checkpoints.rewind(id, entryId),
    cancelQueued: (id, itemId) => conversations.cancelQueued(id, itemId),
    checkpoints: (id) => checkpoints.list(id),
    checkpointDiff: (id, checkpointId, path) => checkpoints.diff(id, checkpointId, path),
  };
}
