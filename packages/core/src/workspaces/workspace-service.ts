import {
  AppError,
  type ConversationSummary,
  type Core,
  type Project,
  type ThreadWorkspace,
  type WorkspaceMode,
} from "@tau/protocol";
import type { RunGh } from "../github/run-gh";
import { legacyWorkspace } from "../harness/conversation-index";
import type { ConversationStore } from "../harness/conversation-store";
import { createKeyedLock } from "./keyed-lock";
import { openPullRequest, requireGithubConnected } from "./pull-request";
import { inWorktree } from "./repo-facts";
import { otherThreadsUsingWorktree } from "./shared-worktree";
import { createWorktreeWorkspace } from "./worktree-create";
import {
  describeUnmergedWork,
  hasLiveWorktree,
  readStatus,
  requireIdle,
  requireLiveWorktree,
  type WorktreeFacts,
  worktreeFactsIfPresent,
  worktreeFactsOf,
} from "./worktree-facts";
import { mergeIntoBase } from "./worktree-merge";
import { removeWorktreeAndBranch } from "./worktree-remove";

export interface CreateWorkspaceRequest {
  readonly project: Project;
  readonly mode: WorkspaceMode;
  /** Idempotency key: a retried start must reuse the worktree it already made. */
  readonly requestId: string;
  readonly firstMessage: string;
}

export interface WorkspaceOperations {
  /** Checkout mode (and any project that is not inside a git repo) answers `legacyWorkspace(project.path)`. */
  create(request: CreateWorkspaceRequest): Promise<ThreadWorkspace>;
  /** Uncommitted files and unmerged commits that deleting the thread would lose; empty for checkouts. */
  unmergedWork(conversation: ConversationSummary): Promise<string[]>;
  /** Removes the worktree and branch of a deleted thread (the guard already ran). */
  onConversationRemoved(conversation: ConversationSummary): Promise<void>;
  onProjectRemoved(projectId: string): Promise<void>;
}

export type WorkspaceService = Core["workspaces"] & WorkspaceOperations;

export interface WorkspaceDeps {
  readonly home: string;
  readonly conversations: ConversationStore;
  /** Without it, `createPullRequest` answers `github_unavailable`. */
  readonly runGh?: RunGh;
  /** Called with the project id after a workspace change so the sidebar can refresh. */
  readonly announce?: (projectId: string) => void;
}

const notFound = () => new AppError("not_found", "Conversation not found.");

export function createWorkspaceService({
  home,
  conversations,
  runGh,
  announce = () => undefined,
}: WorkspaceDeps): WorkspaceService {
  const lock = createKeyedLock();

  async function threadOf(id: string): Promise<ConversationSummary> {
    return (await conversations.find(id)) ?? Promise.reject(notFound());
  }

  async function liveWorktreeOf(id: string) {
    const thread = await threadOf(id);
    requireLiveWorktree(thread);
    return { thread, facts: await worktreeFactsOf(thread) };
  }

  async function update(thread: ConversationSummary, change: Partial<ThreadWorkspace>) {
    const updated = await conversations.setWorkspace(thread.id, { ...thread.workspace, ...change });
    announce(thread.projectId);
    return updated;
  }

  async function removeOne(thread: ConversationSummary, facts: WorktreeFacts, discard: boolean) {
    await removeWorktreeAndBranch(facts, discard);
    return update(thread, { state: "removed", path: inWorktree(facts.mainRoot, facts.subpath) });
  }

  const isSharedWithOthers = async (thread: ConversationSummary) =>
    (await otherThreadsUsingWorktree(conversations, thread)).length > 0;

  async function discardWorktreeOf(thread: ConversationSummary): Promise<void> {
    if (await isSharedWithOthers(thread)) return;
    const facts = hasLiveWorktree(thread) ? await worktreeFactsIfPresent(thread) : undefined;
    if (facts) {
      await lock.run(facts.mainRoot, () => removeWorktreeAndBranch(facts, true));
    }
  }

  return {
    async create(request) {
      if (request.mode === "checkout" || request.project.kind === "home") {
        return legacyWorkspace(request.project.path);
      }
      return lock.run(request.project.path, () => createWorktreeWorkspace(home, request));
    },

    async status(id) {
      const thread = await threadOf(id);
      requireLiveWorktree(thread);
      return readStatus(thread);
    },

    async merge(id) {
      const { thread, facts } = await liveWorktreeOf(id);
      requireIdle(thread);
      return lock.run(facts.mainRoot, async () => {
        const mergedSha = await mergeIntoBase(facts);
        return update(thread, { state: "merged", mergedSha });
      });
    },

    async createPullRequest(id) {
      const { thread, facts } = await liveWorktreeOf(id);
      requireIdle(thread);
      if (thread.workspace.pullRequestUrl !== null) return thread;
      const gh = await requireGithubConnected(runGh);
      return lock.run(facts.mainRoot, async () => {
        const pullRequestUrl = await openPullRequest(gh, facts, thread.title);
        return update(thread, { pullRequestUrl });
      });
    },

    async remove(id, force) {
      const thread = await threadOf(id);
      if (thread.workspace.state === "removed") return thread;
      const { facts } = await liveWorktreeOf(id);
      requireIdle(thread);
      return lock.run(facts.mainRoot, async () => {
        if (await isSharedWithOthers(thread)) {
          return update(thread, { state: "removed", path: inWorktree(facts.mainRoot, facts.subpath) });
        }
        const lost = await describeUnmergedWork(thread);
        if (lost.length > 0 && !force) {
          throw new AppError("has_unmerged_work", `This worktree has unmerged work: ${lost.join(", ")}`);
        }
        return removeOne(thread, facts, false);
      });
    },

    async unmergedWork(thread) {
      return (await isSharedWithOthers(thread)) ? [] : describeUnmergedWork(thread);
    },
    onConversationRemoved: discardWorktreeOf,

    async onProjectRemoved(projectId) {
      const threads = await conversations.list(projectId).catch(() => []);
      for (const thread of threads) await discardWorktreeOf(thread).catch(() => undefined);
    },
  };
}
