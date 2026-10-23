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
import { createStatusCache } from "./status-cache";
import {
  readWorkspaceGitStatus,
  type WorkspaceGitStatus,
  workspaceStatusKey,
  workspaceStatusOf,
} from "./workspace-git-status";
import { createWorktreeWorkspace } from "./worktree-create";
import {
  describeUnmergedWork,
  hasLiveWorktree,
  requireIdle,
  requireLiveWorktree,
  type WorktreeFacts,
  worktreeFactsIfPresent,
  worktreeFactsOf,
} from "./worktree-facts";
import { mergeIntoBase } from "./worktree-merge";
import { removeWorktreeAndBranch } from "./worktree-remove";
import { createWriterBarrier, type WriterBarrier } from "./writer-barrier";

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
  /** Closes the thread's terminals before its worktree goes. The default does nothing. */
  readonly closeTerminalsOf?: (conversationId: string) => Promise<void>;
  /**
   * Removal race: background processes and monitors outlive the model run, so
   * `requireIdle` cannot see them. The core wires this to
   * `ProcessService.hasRunning`; removal refuses while it reports jobs.
   */
  readonly hasRunningOf?: (conversationId: string) => boolean;
  /** Shared with the conversations API so sends into a workspace being merged or removed are refused. */
  readonly writerBarrier?: WriterBarrier;
}

const notFound = () => new AppError("not_found", "Conversation not found.");

const ownBackgroundProcesses = () =>
  new AppError(
    "thread_busy",
    "This thread still has running background processes. Stop them first, then remove the worktree.",
  );

const siblingStillRunning = () =>
  new AppError(
    "thread_busy",
    "Another thread sharing this worktree is still running. Wait for it to finish, then try again.",
  );

const siblingUnverifiable = () =>
  new AppError(
    "thread_busy",
    "Could not verify the other threads sharing this worktree. Try again in a moment.",
  );

const siblingHasBackgroundProcesses = () =>
  new AppError(
    "thread_busy",
    "Another thread sharing this worktree still has running background processes. Stop them first.",
  );

const isKnownStatus = (status: string) => status === "idle" || status === "running" || status === "error";

export function createWorkspaceService({
  home,
  conversations,
  runGh,
  announce = () => undefined,
  closeTerminalsOf = async () => undefined,
  hasRunningOf,
  writerBarrier = createWriterBarrier(),
}: WorkspaceDeps): WorkspaceService {
  const lock = createKeyedLock();
  const statusCache = createStatusCache<WorkspaceGitStatus>();

  async function mutating<T>(operation: () => Promise<T>): Promise<T> {
    statusCache.invalidate();
    try {
      return await operation();
    } finally {
      statusCache.invalidate();
    }
  }

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
    statusCache.invalidate();
    announce(thread.projectId);
    return updated;
  }

  async function removeOne(thread: ConversationSummary, facts: WorktreeFacts, discard: boolean) {
    await removeWorktreeAndBranch(facts, discard);
    return update(thread, { state: "removed", path: inWorktree(facts.mainRoot, facts.subpath) });
  }

  const isSharedWithOthers = async (thread: ConversationSummary) =>
    (await otherThreadsUsingWorktree(conversations, thread)).length > 0;

  const barrierKeyOf = (thread: ConversationSummary) => thread.workspace.path;

  const withWriterBarrier = <T>(thread: ConversationSummary, facts: WorktreeFacts, task: () => Promise<T>) =>
    writerBarrier.run(barrierKeyOf(thread), thread.id, () => lock.run(facts.mainRoot, task));

  async function verifiedSiblingsOf(thread: ConversationSummary): Promise<ConversationSummary[]> {
    await conversations.list(thread.projectId).catch(() => Promise.reject(siblingUnverifiable()));
    const siblings = await otherThreadsUsingWorktree(conversations, thread);
    return Promise.all(siblings.map(freshStateOf));
  }

  async function freshStateOf(sibling: ConversationSummary): Promise<ConversationSummary> {
    const current = await conversations.find(sibling.id).catch(() => undefined);
    if (!current || !isKnownStatus(current.status)) throw siblingUnverifiable();
    return current;
  }

  async function requireNoRunningSiblings(thread: ConversationSummary, checkProcesses: boolean) {
    for (const sibling of await verifiedSiblingsOf(thread)) {
      if (sibling.status === "running") throw siblingStillRunning();
      if (checkProcesses && hasRunningOf?.(sibling.id)) throw siblingHasBackgroundProcesses();
    }
  }

  async function discardWorktreeOf(thread: ConversationSummary): Promise<void> {
    if (await isSharedWithOthers(thread)) return;
    const facts = hasLiveWorktree(thread) ? await worktreeFactsIfPresent(thread) : undefined;
    if (!facts) return;
    await withWriterBarrier(thread, facts, async () => {
      if ((await verifiedSiblingsOf(thread)).length > 0) return;
      await removeWorktreeAndBranch(facts, true);
    });
  }

  const operations: WorkspaceService = {
    async create(request) {
      if (request.mode === "checkout" || request.project.kind === "home") {
        return legacyWorkspace(request.project.path);
      }
      return lock.run(request.project.path, () => createWorktreeWorkspace(home, request));
    },

    async status(id) {
      const thread = await threadOf(id);
      requireLiveWorktree(thread);
      const key = workspaceStatusKey(thread.workspace);
      const facts = await statusCache.get(key, () => readWorkspaceGitStatus(thread.workspace));
      const current = await threadOf(id);
      requireLiveWorktree(current);
      if (workspaceStatusKey(current.workspace) !== key) return operations.status(id);
      return workspaceStatusOf(current, facts);
    },

    async merge(id, force) {
      const { thread, facts } = await liveWorktreeOf(id);
      // The idle gate guards other people's clicks, not the owner landing its own work: a thread
      // merging from inside its own run is always "running", so `force` (CLI `--force`) is its way in.
      // The git-level guards below still hold: a dirty worktree refuses, the rebase aborts on conflict.
      if (!force && thread.status === "running") {
        throw new AppError(
          "thread_busy",
          `Thread ${id} is still running. Wait for it to finish, or merge anyway with \`tau workspaces merge ${id} --force\`.`,
        );
      }
      return withWriterBarrier(thread, facts, async () => {
        const current = await threadOf(id);
        requireLiveWorktree(current);
        if (!force) requireIdle(current);
        await requireNoRunningSiblings(current, false);
        const mergedSha = await mergeIntoBase(facts);
        return update(current, { state: "merged", mergedSha });
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
      if (hasRunningOf?.(thread.id)) throw ownBackgroundProcesses();
      return withWriterBarrier(thread, facts, async () => {
        const current = await threadOf(id);
        if (current.workspace.state === "removed") return current;
        requireLiveWorktree(current);
        requireIdle(current);
        if (hasRunningOf?.(current.id)) throw ownBackgroundProcesses();
        await requireNoRunningSiblings(current, true);
        const shared = await isSharedWithOthers(current);
        if (!shared) {
          const lost = await describeUnmergedWork(current);
          if (lost.length > 0 && !force) {
            throw new AppError("has_unmerged_work", `This worktree has unmerged work: ${lost.join(", ")}`);
          }
        }
        await closeTerminalsOf(current.id);
        if (shared) {
          return update(current, { state: "removed", path: inWorktree(facts.mainRoot, facts.subpath) });
        }
        return removeOne(current, facts, false);
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

  return {
    ...operations,
    create: (request) => mutating(() => operations.create(request)),
    merge: (id, force) => mutating(() => operations.merge(id, force)),
    createPullRequest: (id) => mutating(() => operations.createPullRequest(id)),
    remove: (id, force) => mutating(() => operations.remove(id, force)),
    onConversationRemoved: (thread) => mutating(() => operations.onConversationRemoved(thread)),
    onProjectRemoved: (id) => mutating(() => operations.onProjectRemoved(id)),
  };
}
