import { localRef } from "./repo-facts";
import { git, tryGit } from "./run-repo-command";
import type { WorktreeFacts } from "./worktree-facts";

async function branchIsMergedIntoBase({ mainRoot, branch, base }: WorktreeFacts): Promise<boolean> {
  return (await tryGit(mainRoot, ["merge-base", "--is-ancestor", localRef(branch), localRef(base)])).ok;
}

async function deleteBranch(facts: WorktreeFacts, discardUnmerged: boolean): Promise<void> {
  const soft = await tryGit(facts.mainRoot, ["branch", "-d", "--", facts.branch]);
  if (soft.ok) return;
  if (discardUnmerged || (await branchIsMergedIntoBase(facts))) {
    await tryGit(facts.mainRoot, ["branch", "-D", "--", facts.branch]);
  }
}

export async function removeWorktreeAndBranch(facts: WorktreeFacts, discardUnmerged: boolean): Promise<void> {
  await git(facts.mainRoot, ["worktree", "remove", "--force", "--", facts.worktreeRoot]);
  await deleteBranch(facts, discardUnmerged);
}
