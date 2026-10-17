import type { Checkpoint, ConversationSummary, RestorePreview } from "@pi-everywhere/protocol";
import type { ConversationForker } from "../harness/conversation-fork";
import type { ConversationStore } from "../harness/conversation-store";
import { notImplemented } from "../not-implemented";

export interface CheckpointService {
  /** Called when a message is submitted (keyed by its `requestId`). Must never throw into a send. */
  snapshotBefore(conversationId: string, requestId: string): Promise<void>;
  /** Called when a run ends. Must never throw into the status tracker. */
  snapshotAfter(conversationId: string, requestId: string): Promise<void>;
  list(conversationId: string): Promise<Checkpoint[]>;
  diff(conversationId: string, checkpointId: string, path: string): Promise<string>;
  preview(conversationId: string, entryId: string): Promise<RestorePreview>;
  /** Restores files to the entry's "before" checkpoint, forks before the entry, returns the message text. */
  rewind(
    conversationId: string,
    entryId: string,
  ): Promise<{ conversation: ConversationSummary; draft: string }>;
  /** Deletes the thread's refs and index file. */
  onConversationRemoved(conversation: ConversationSummary): Promise<void>;
}

export interface CheckpointDeps {
  readonly home: string;
  readonly conversations: ConversationStore;
  readonly forker: ConversationForker;
}

const reject = (what: string) => async (): Promise<never> => {
  throw notImplemented(what);
};

export function createCheckpointService(_deps: CheckpointDeps): CheckpointService {
  return {
    snapshotBefore: async () => undefined,
    snapshotAfter: async () => undefined,
    list: reject("checkpoints.list"),
    diff: reject("checkpoints.diff"),
    preview: reject("checkpoints.preview"),
    rewind: reject("checkpoints.rewind"),
    onConversationRemoved: async () => undefined,
  };
}
