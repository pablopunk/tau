import type { ConversationId } from "@earendil-works/pi-durable";
import type { ConversationSummary } from "@tau/protocol";
import type { ConversationForker } from "../harness/conversation-fork";
import { isBusy } from "../harness/live-state";
import type { CheckpointStore, CheckpointsValue, StoredCheckpoint } from "./checkpoint-store";
import { type Repo, repoOf } from "./repo";
import { refOf, takeSnapshot } from "./snapshot";
import { changedFiles } from "./tree-diff";

export interface CheckpointRecorderDeps {
  readonly home: string;
  readonly store: CheckpointStore;
  readonly forker: ConversationForker;
  readonly findThread: (conversationId: string) => Promise<ConversationSummary | undefined>;
}

const hasAfter = (doc: CheckpointsValue, requestId: string) =>
  doc.items.some((item) => item.kind === "after" && item.requestId === requestId);

const unmatchedBefores = (doc: CheckpointsValue) =>
  doc.items.filter((item) => item.kind === "before" && !hasAfter(doc, item.requestId));

/** The unlocked steps of recording; the service runs each one under the thread's lock. */
export function createCheckpointRecorder(deps: CheckpointRecorderDeps) {
  const { home, store, forker, findThread } = deps;

  async function repoOfThread(conversationId: string): Promise<Repo | undefined> {
    const thread = await findThread(conversationId);
    if (!thread || thread.workspace.state === "removed") return undefined;
    return repoOf(thread.workspace.path);
  }

  const record = (conversationId: string, repo: Repo, n: number, items: StoredCheckpoint[]) =>
    store.update(conversationId, (doc) => {
      doc.root = repo.root;
      doc.gitDir = repo.commonDir;
      doc.next = Math.max(doc.next, n + 1);
      doc.items.push(...items);
    });

  async function recordBefore(conversationId: string, requestId: string): Promise<void> {
    const repo = await repoOfThread(conversationId);
    if (!repo) return;
    const doc = await store.read(conversationId);
    if (doc.items.some((item) => item.kind === "before" && item.requestId === requestId)) return;
    const sha = await takeSnapshot({ home, conversationId, repo }, refOf(conversationId, doc.next));
    await record(conversationId, repo, doc.next, [
      { requestId, kind: "before", entryId: null, sha, n: doc.next, at: Date.now(), files: [] },
    ]);
  }

  async function recordAfters(conversationId: string): Promise<void> {
    const doc = await store.read(conversationId);
    const pending = unmatchedBefores(doc);
    const repo = await repoOfThread(conversationId);
    if (pending.length === 0 || !repo) return;
    const sha = await takeSnapshot({ home, conversationId, repo }, refOf(conversationId, doc.next));
    const afters: StoredCheckpoint[] = [];
    for (const before of pending) {
      const files = await changedFiles(repo, before.sha, sha);
      afters.push({ ...before, kind: "after", sha, n: doc.next, at: Date.now(), files });
    }
    await record(conversationId, repo, doc.next, afters);
  }

  async function recordAftersWhenIdle(conversationId: string): Promise<void> {
    if (await isBusy(forker.harness, Number(conversationId) as ConversationId)) return;
    await recordAfters(conversationId);
  }

  async function resolveEntryIds(conversationId: string): Promise<void> {
    const doc = await store.read(conversationId);
    const unresolved = [
      ...new Set(doc.items.filter((item) => item.entryId === null).map((item) => item.requestId)),
    ];
    const resolved = new Map<string, string>();
    for (const requestId of unresolved) {
      const entryId = await forker.entryOfRequest(conversationId, requestId);
      if (entryId !== null) resolved.set(requestId, entryId);
    }
    if (resolved.size === 0) return;
    await store.update(conversationId, (current) => {
      for (const item of current.items) item.entryId = item.entryId ?? resolved.get(item.requestId) ?? null;
    });
  }

  return { recordBefore, recordAfters, recordAftersWhenIdle, resolveEntryIds };
}
