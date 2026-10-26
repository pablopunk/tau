import type { ConversationId } from "@earendil-works/pi-durable";
import { AppError, type Checkpoint, type ConversationSummary, type RestorePreview } from "@tau/protocol";
import type { ConversationForker } from "../harness/conversation-fork";
import type { ConversationStore } from "../harness/conversation-store";
import { isBusy } from "../harness/live-state";
import { createCheckpointRecorder } from "./checkpoint-recorder";
import {
  type CheckpointsValue,
  createCheckpointStore,
  repoOfDoc,
  type StoredCheckpoint,
} from "./checkpoint-store";
import { createKeyedLock } from "./keyed-lock";
import { relocateDoc } from "./relocate";
import type { Repo } from "./repo";
import { applyRestore, planRestore, previewOf, type RestoreStep } from "./restore";
import { deleteIndexFile, deleteRefsOf, pointRefAt, refOf, takeSnapshot, takeTree } from "./snapshot";
import { fileDiff } from "./tree-diff";
import { requireRepoRelative } from "./validate-path";

export interface CheckpointService {
  /** Called when a message is submitted (keyed by its `requestId`). Must never throw into a send. */
  snapshotBefore(conversationId: string, requestId: string): Promise<void>;
  /** Called when a run ends. Must never throw into the status tracker. Pairs every message without an "after". */
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
  /** Points the thread's snapshot repository at the moved project folder. */
  relocate(conversationId: string, oldRoot: string, newRoot: string): Promise<void>;
}

export interface CheckpointDeps {
  readonly home: string;
  readonly conversations: ConversationStore;
  readonly forker: ConversationForker;
}

const checkpointId = (item: StoredCheckpoint) => `${item.requestId}:${item.kind}`;

const toCheckpoint = (item: StoredCheckpoint): Checkpoint => ({
  id: checkpointId(item),
  requestId: item.requestId,
  entryId: item.entryId,
  kind: item.kind,
  at: item.at,
  files: item.files,
});

/** An "after" compares with its own "before"; a "before" with the newest "after" that precedes it. */
function baseOf(items: readonly StoredCheckpoint[], index: number): StoredCheckpoint | undefined {
  const item = items[index];
  if (!item) return undefined;
  if (item.kind === "after") {
    return items.find((other) => other.kind === "before" && other.requestId === item.requestId);
  }
  return items
    .slice(0, index)
    .reverse()
    .find((other) => other.kind === "after");
}

const notFound = () => new AppError("not_found", "Checkpoint not found.");

export function createCheckpointService(deps: CheckpointDeps): CheckpointService {
  const { home, conversations, forker } = deps;
  const store = createCheckpointStore(forker.harness);
  const recorder = createCheckpointRecorder({
    home,
    store,
    forker,
    findThread: (id) => conversations.find(id),
  });
  const underLock = createKeyedLock();
  const never = (what: string) => (error: unknown) => console.error(`tau: could not ${what}`, error);

  async function readSettled(conversationId: string): Promise<CheckpointsValue> {
    await underLock(conversationId, async () => {
      await recorder.recordAftersWhenIdle(conversationId);
      await recorder.resolveEntryIds(conversationId);
    });
    return store.read(conversationId);
  }

  async function requireThread(conversationId: string): Promise<ConversationSummary> {
    const thread = await conversations.find(conversationId);
    if (!thread) throw new AppError("not_found", "Conversation not found.");
    return thread;
  }

  async function requireNothingRunningIn(thread: ConversationSummary): Promise<void> {
    const sameFolder = (await conversations.list(thread.projectId)).filter(
      (other) => other.workspace.path === thread.workspace.path,
    );
    for (const other of sameFolder) {
      if (other.status === "running" || (await isBusy(forker.harness, Number(other.id) as ConversationId))) {
        throw new AppError("thread_busy", "A thread in this folder is running. Stop it first.");
      }
    }
  }

  async function beforeOf(conversationId: string, entryId: string) {
    const doc = await readSettled(conversationId);
    const before = doc.items.find((item) => item.kind === "before" && item.entryId === entryId);
    return { doc, before };
  }

  async function plan(conversationId: string, repo: Repo, before: StoredCheckpoint): Promise<RestoreStep[]> {
    const tree = await takeTree({ home, conversationId, repo });
    return planRestore(repo, before.sha, tree);
  }

  async function restoreFiles(conversationId: string, doc: CheckpointsValue, before: StoredCheckpoint) {
    const repo = repoOfDoc(doc);
    if (!repo) return;
    const steps = await plan(conversationId, repo, before);
    if (steps.length === 0) return;
    await takeSnapshot({ home, conversationId, repo }, refOf(conversationId, `restore-${Date.now()}`));
    await applyRestore(repo, steps);
  }

  async function pinInheritedRefs(fork: ConversationSummary): Promise<void> {
    const doc = await store.read(fork.id);
    const repo = repoOfDoc(doc);
    if (!repo) return;
    for (const item of doc.items) await pointRefAt(repo, refOf(fork.id, item.n), item.sha);
  }
  forker.onForked((fork) => pinInheritedRefs(fork).catch(never("keep a fork's checkpoints")));

  return {
    snapshotBefore: (conversationId, requestId) =>
      underLock(conversationId, async () => {
        await recorder.recordAftersWhenIdle(conversationId);
        await recorder.recordBefore(conversationId, requestId);
      }).catch(never("take a checkpoint")),

    snapshotAfter: (conversationId) =>
      underLock(conversationId, async () => {
        if (await conversations.find(conversationId)) await recorder.recordAfters(conversationId);
      }).catch(never("take a checkpoint")),

    async list(conversationId) {
      await requireThread(conversationId);
      return (await readSettled(conversationId)).items.map(toCheckpoint);
    },

    async diff(conversationId, id, path) {
      requireRepoRelative(path);
      await requireThread(conversationId);
      const doc = await readSettled(conversationId);
      const index = doc.items.findIndex((item) => checkpointId(item) === id);
      const item = doc.items[index];
      const repo = repoOfDoc(doc);
      if (!item || !repo) throw notFound();
      const base = baseOf(doc.items, index);
      return base ? fileDiff(repo, base.sha, item.sha, path) : "";
    },

    async preview(conversationId, entryId) {
      await requireThread(conversationId);
      await forker.messageText(conversationId, entryId);
      const { doc, before } = await beforeOf(conversationId, entryId);
      const repo = repoOfDoc(doc);
      if (!before || !repo) return { checkpointId: "", changes: [] };
      return underLock(conversationId, async () =>
        previewOf(checkpointId(before), await plan(conversationId, repo, before)),
      );
    },

    async rewind(conversationId, entryId) {
      const thread = await requireThread(conversationId);
      await requireNothingRunningIn(thread);
      const draft = await forker.messageText(conversationId, entryId);
      const { doc, before } = await beforeOf(conversationId, entryId);
      const conversation = await forker.fork(conversationId, entryId, { before: true });
      if (before) await underLock(conversationId, () => restoreFiles(conversationId, doc, before));
      return { conversation, draft };
    },

    onConversationRemoved: (conversation) =>
      underLock(conversation.id, async () => {
        const doc = await store.read(conversation.id).catch(() => undefined);
        if (doc?.gitDir) {
          await deleteRefsOf(doc.gitDir, conversation.id).catch(never("delete checkpoint refs"));
        }
        await deleteIndexFile(home, conversation.id);
      }),

    relocate: (conversationId, oldRoot, newRoot) =>
      underLock(conversationId, () =>
        store.update(conversationId, (doc) => relocateDoc(doc, oldRoot, newRoot)),
      ),
  };
}
