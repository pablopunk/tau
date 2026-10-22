import { access, realpath, stat } from "node:fs/promises";
import { AppError, type ConversationSummary, type WorkspaceStatus } from "@tau/protocol";
import { locateRepo, mainCheckoutRoot } from "./repo-facts";
import { readWorkspaceGitStatus, workspaceStatusOf } from "./workspace-git-status";

export interface WorktreeFacts {
  readonly worktreeRoot: string;
  readonly subpath: string;
  readonly mainRoot: string;
  readonly branch: string;
  readonly base: string;
}

export const hasLiveWorktree = ({ workspace }: ConversationSummary) =>
  workspace.mode === "worktree" && workspace.state !== "removed";

export function requireLiveWorktree(thread: ConversationSummary): void {
  if (!hasLiveWorktree(thread)) {
    throw new AppError("invalid_request", "This thread has no worktree.");
  }
}

export function requireIdle(thread: ConversationSummary): void {
  if (thread.status === "running") throw new AppError("thread_busy", "The thread is running.");
}

export async function worktreeFactsOf(thread: ConversationSummary): Promise<WorktreeFacts> {
  const { path, branch, base } = thread.workspace;
  const location = await locateRepo(path);
  if (!location || branch === null || base === null) {
    throw new AppError("internal", "The worktree is missing on disk.");
  }
  return {
    worktreeRoot: location.root,
    subpath: location.subpath,
    mainRoot: await mainCheckoutRoot(location.root),
    branch,
    base,
  };
}

export async function worktreeFactsIfPresent(
  thread: ConversationSummary,
): Promise<WorktreeFacts | undefined> {
  const present = await access(thread.workspace.path).then(
    () => true,
    () => false,
  );
  return present ? worktreeFactsOf(thread) : undefined;
}

const SUMMARY_PREVIEW = 5;

/**
 * Trust root for Layer 1 (spawns) and Layer 2 (in-process writes): the canonical
 * root resolved from trusted thread metadata (mode + workspace path), never
 * from a tool's `cwd`. Worktree threads resolve to their worktree, checkout
 * threads to the main checkout; removed threads and unresolvable paths deny
 * with `undefined` (fail closed), so callers reject the write or spawn.
 */
export async function sandboxRootOf(thread: ConversationSummary): Promise<string | undefined> {
  if (thread.workspace.state === "removed") return undefined;
  if (hasLiveWorktree(thread)) {
    const facts = await worktreeFactsIfPresent(thread).catch(() => undefined);
    if (!facts) return undefined;
    return realpath(facts.worktreeRoot).catch(() => undefined);
  }
  try {
    const canonical = await realpath(thread.workspace.path);
    return (await stat(canonical)).isDirectory() ? canonical : undefined;
  } catch {
    return undefined;
  }
}

export async function readStatus(thread: ConversationSummary): Promise<WorkspaceStatus> {
  return workspaceStatusOf(thread, await readWorkspaceGitStatus(thread.workspace));
}

export async function describeUnmergedWork(thread: ConversationSummary): Promise<string[]> {
  if (!hasLiveWorktree(thread) || !(await worktreeFactsIfPresent(thread))) return [];
  const { dirtyFiles, unmergedCommits } = await readStatus(thread);
  const files = dirtyFiles.slice(0, SUMMARY_PREVIEW);
  const hidden = dirtyFiles.length - files.length;
  const lines = hidden > 0 ? [...files, `${hidden} more files`] : files;
  return unmergedCommits > 0 ? [...lines, `${unmergedCommits} unmerged commit(s)`] : lines;
}
