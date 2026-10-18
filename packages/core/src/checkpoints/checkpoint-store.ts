import { type ConversationId, defineDoc, type Harness } from "@earendil-works/pi-durable";
import { BACKGROUND } from "../harness/open";
import type { Repo } from "./repo";
import type { FileChange } from "./tree-diff";

export type StoredCheckpoint = {
  requestId: string;
  kind: "before" | "after";
  entryId: string | null;
  sha: string;
  /** Names the ref `refs/tau/<conversationId>/<n>`; the afters of one run share it. */
  n: number;
  at: number;
  files: FileChange[];
};

export type CheckpointsValue = {
  /** The repository the snapshots live in; empty until the first snapshot. */
  root: string;
  gitDir: string;
  next: number;
  items: StoredCheckpoint[];
};

export const CheckpointsDoc = defineDoc<CheckpointsValue>({
  kind: "app.checkpoints",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ root: "", gitDir: "", next: 1, items: [] }),
});

const idOf = (conversationId: string) => Number(conversationId) as ConversationId;

export const repoOfDoc = (doc: Readonly<CheckpointsValue>): Repo | undefined =>
  doc.root === "" ? undefined : { root: doc.root, commonDir: doc.gitDir };

export interface CheckpointStore {
  read(conversationId: string): Promise<CheckpointsValue>;
  /** Applies `change` to the thread's document in one commit. */
  update(conversationId: string, change: (doc: CheckpointsValue) => void): Promise<void>;
}

export function createCheckpointStore(harness: Harness): CheckpointStore {
  return {
    async read(conversationId) {
      const stored = await harness.snapshot(CheckpointsDoc, idOf(conversationId), BACKGROUND);
      return structuredClone(stored ?? CheckpointsDoc.definition.initial());
    },
    update(conversationId, change) {
      return harness.commit(async (tx) => {
        change(await tx.doc(CheckpointsDoc, idOf(conversationId)));
      }, BACKGROUND);
    },
  };
}
