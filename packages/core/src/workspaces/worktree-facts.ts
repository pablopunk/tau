import { access } from "node:fs/promises";
import { AppError, type ConversationSummary, type WorkspaceStatus } from "@pi-everywhere/protocol";
import { countCommits, dirtyFilesOf, localRef, locateRepo, mainCheckoutRoot } from "./repo-facts";

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

function mergeBlocker(thread: ConversationSummary, dirty: readonly string[], ahead: number): string | null {
  if (thread.status === "running") return "The thread is running.";
  if (dirty.length > 0) return "The worktree has uncommitted changes.";
  if (thread.workspace.state === "merged" && ahead === 0) return "Already merged.";
  return null;
}

export async function readStatus(thread: ConversationSummary): Promise<WorkspaceStatus> {
  const facts = await worktreeFactsOf(thread);
  const { worktreeRoot, branch, base } = facts;
  const ahead = await countCommits(worktreeRoot, `${localRef(base)}..${localRef(branch)}`);
  const behind = await countCommits(worktreeRoot, `${localRef(branch)}..${localRef(base)}`);
  const dirtyFiles = await dirtyFilesOf(worktreeRoot);
  const reason = mergeBlocker(thread, dirtyFiles, ahead);
  return { ahead, behind, dirtyFiles, unmergedCommits: ahead, canMerge: reason === null, reason };
}

export async function describeUnmergedWork(thread: ConversationSummary): Promise<string[]> {
  if (!hasLiveWorktree(thread) || !(await worktreeFactsIfPresent(thread))) return [];
  const { dirtyFiles, unmergedCommits } = await readStatus(thread);
  const files = dirtyFiles.slice(0, SUMMARY_PREVIEW);
  const hidden = dirtyFiles.length - files.length;
  const lines = hidden > 0 ? [...files, `${hidden} more files`] : files;
  return unmergedCommits > 0 ? [...lines, `${unmergedCommits} unmerged commit(s)`] : lines;
}
