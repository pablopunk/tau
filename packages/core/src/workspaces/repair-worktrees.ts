import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConversationSummary } from "@tau/protocol";
import { tryGit } from "./run-repo-command";
import { hasLiveWorktree } from "./worktree-facts";

export const liveWorktreeThreads = (threads: readonly ConversationSummary[]) =>
  threads.filter(hasLiveWorktree);

const hasGitLink = (directory: string) =>
  access(join(directory, ".git")).then(
    () => true,
    () => false,
  );

async function worktreeRootOf(path: string): Promise<string | undefined> {
  if (await hasGitLink(path)) return path;
  const parent = dirname(path);
  return parent === path ? undefined : worktreeRootOf(parent);
}

export async function repairWorktrees(newRepo: string, threads: readonly ConversationSummary[]) {
  const roots = await Promise.all(liveWorktreeThreads(threads).map((t) => worktreeRootOf(t.workspace.path)));
  const unique = [...new Set(roots.filter((root) => root !== undefined))];
  if (unique.length > 0) await tryGit(newRepo, ["worktree", "repair", ...unique]);
}
