import { AppError, type ConversationSummary, type Core } from "@tau/protocol";
import type { FakeConversation } from "./fake-conversation";
import { checkoutWorkspace, FAKE_MERGED_SHA, FAKE_PULL_REQUEST_URL } from "./fake-workspace";

export interface WorkspacesContext {
  require(id: string): FakeConversation;
  projectPath(projectId: string): string;
  githubConnected(): Promise<boolean>;
  changed(conversation: FakeConversation): void;
}

function requireWorktree(conversation: FakeConversation): void {
  if (conversation.workspace.mode !== "worktree" || conversation.workspace.state === "removed") {
    throw new AppError("invalid_request", "This thread has no worktree.");
  }
}

function mergeBlocker(
  conversation: FakeConversation,
): { code: "thread_busy" | "worktree_dirty"; message: string } | null {
  if (conversation.isBusy()) return { code: "thread_busy", message: "The thread is running." };
  if (conversation.changes.dirtyFiles.length > 0) {
    return { code: "worktree_dirty", message: "The worktree has uncommitted changes." };
  }
  return null;
}

export function hasUnmergedWork(conversation: FakeConversation): boolean {
  const { workspace, changes } = conversation;
  const active = workspace.mode === "worktree" && workspace.state === "ready";
  return active && (changes.dirtyFiles.length > 0 || changes.unmergedCommits > 0);
}

export function createFakeWorkspaces(ctx: WorkspacesContext): Core["workspaces"] {
  const settle = (conversation: FakeConversation): ConversationSummary => {
    ctx.changed(conversation);
    return conversation.summary();
  };

  return {
    async status(conversationId) {
      const conversation = ctx.require(conversationId);
      requireWorktree(conversation);
      const blocker = mergeBlocker(conversation);
      const merged = conversation.workspace.state === "merged";
      return {
        ahead: conversation.changes.unmergedCommits,
        behind: 0,
        dirtyFiles: [...conversation.changes.dirtyFiles],
        unmergedCommits: conversation.changes.unmergedCommits,
        canMerge: blocker === null && !merged,
        reason: blocker?.message ?? (merged ? "Already merged." : null),
      };
    },
    async merge(conversationId, force) {
      const conversation = ctx.require(conversationId);
      requireWorktree(conversation);
      // Like the real service, `force` skips the running check but never the dirty one.
      if (conversation.isBusy() && !force)
        throw new AppError("thread_busy", "The thread is running.");
      if (conversation.changes.dirtyFiles.length > 0)
        throw new AppError("worktree_dirty", "The worktree has uncommitted changes.");
      conversation.changes.unmergedCommits = 0;
      conversation.workspace = { ...conversation.workspace, state: "merged", mergedSha: FAKE_MERGED_SHA };
      return settle(conversation);
    },
    async createPullRequest(conversationId) {
      const conversation = ctx.require(conversationId);
      requireWorktree(conversation);
      if (!(await ctx.githubConnected()))
        throw new AppError("github_unavailable", "GitHub is not connected.");
      conversation.workspace = { ...conversation.workspace, pullRequestUrl: FAKE_PULL_REQUEST_URL };
      return settle(conversation);
    },
    async remove(conversationId, force) {
      const conversation = ctx.require(conversationId);
      requireWorktree(conversation);
      if (!force && hasUnmergedWork(conversation)) {
        throw new AppError("has_unmerged_work", "The worktree has unmerged work.");
      }
      conversation.changes.dirtyFiles = [];
      conversation.changes.unmergedCommits = 0;
      conversation.workspace = {
        ...checkoutWorkspace(ctx.projectPath(conversation.projectId)),
        mode: "worktree",
        state: "removed",
      };
      return settle(conversation);
    },
  };
}
