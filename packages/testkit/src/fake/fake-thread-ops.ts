import { AppError, type ConversationSummary, type Core } from "@pi-everywhere/protocol";
import { fakeDiffOf, rejectUnsafePath } from "./fake-checkpoints";
import type { FakeConversation } from "./fake-conversation";
import { reportStopped } from "./fake-subagents";

export interface SpawnParams {
  readonly source: FakeConversation;
  readonly title: string;
  readonly forkOf: ConversationSummary["forkOf"];
  readonly parentId?: string;
}

export interface ThreadOpsContext {
  require(id: string): FakeConversation;
  live(): FakeConversation[];
  spawn(params: SpawnParams): FakeConversation;
}

type ThreadOps = Pick<
  Core["conversations"],
  "fork" | "stopAgent" | "rewindPreview" | "rewind" | "cancelQueued" | "checkpoints" | "checkpointDiff"
>;

const entryIdsOf = (conversation: FakeConversation) => conversation.userEntries().map((entry) => entry.id);

export function createFakeThreadOps(ctx: ThreadOpsContext): ThreadOps {
  const forkAt = (source: FakeConversation, entryId: string, inclusive: boolean, title: string) => {
    const history = source.historyThrough(entryId, inclusive);
    const forkOf = { conversationId: source.id, entryId };
    const child = ctx.spawn({ source, title, forkOf });
    child.adoptHistory(history, source);
    return child;
  };

  return {
    async fork(id, entryId) {
      const source = ctx.require(id);
      return forkAt(source, entryId, true, `Fork of ${source.title}`).summary();
    },
    async rewindPreview(id, entryId) {
      const source = ctx.require(id);
      return source.checkpoints.preview(entryId, entryIdsOf(source));
    },
    async rewind(id, entryId) {
      const source = ctx.require(id);
      const busy = ctx.live().some((item) => item.workspace.path === source.workspace.path && item.isBusy());
      if (busy) throw new AppError("thread_busy", "A thread in this folder is running.");
      const draft = source.userEntries().find((entry) => entry.id === entryId)?.text;
      if (draft === undefined) throw new AppError("not_found", `Unknown entry: ${entryId}`);
      const conversation = forkAt(source, entryId, false, `Fork of ${source.title}`).summary();
      return { conversation, draft };
    },
    async stopAgent(id) {
      const child = ctx.require(id);
      if (child.parentId === null) throw new AppError("invalid_request", "Only a subagent can be stopped.");
      await child.abort();
      reportStopped(child, ctx.require);
    },
    async cancelQueued(id, itemId) {
      return { cancelled: ctx.require(id).cancelQueued(itemId) };
    },
    async checkpoints(id) {
      const source = ctx.require(id);
      return source.checkpoints.list(entryIdsOf(source));
    },
    async checkpointDiff(id, checkpointId, path) {
      rejectUnsafePath(path);
      const source = ctx.require(id);
      const checkpoint = source.checkpoints.find(checkpointId, entryIdsOf(source));
      const file = checkpoint.files.find((candidate) => candidate.path === path);
      return file ? fakeDiffOf(file) : "";
    },
  };
}
