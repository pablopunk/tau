import { AppError } from "@pi-everywhere/protocol";
import { currentBranch, dirtyFilesOf, localRef } from "./repo-facts";
import { failureMessage, gitLine, tryGit } from "./run-repo-command";
import type { WorktreeFacts } from "./worktree-facts";

const NOT_FAST_FORWARD = /not possible to fast-forward|diverging branches/i;

async function requireCleanWorktree({ worktreeRoot }: WorktreeFacts): Promise<void> {
  const dirty = await dirtyFilesOf(worktreeRoot);
  if (dirty.length > 0) {
    throw new AppError("worktree_dirty", `Uncommitted changes: ${dirty.slice(0, 5).join(", ")}`);
  }
}

async function requireBaseCheckedOut({ mainRoot, base }: WorktreeFacts): Promise<void> {
  if ((await currentBranch(mainRoot)) !== base) {
    throw new AppError("not_on_base", `The main checkout is not on ${base}.`);
  }
}

async function rebaseOntoBase({ worktreeRoot, base }: WorktreeFacts): Promise<void> {
  const rebase = await tryGit(worktreeRoot, ["rebase", localRef(base)]);
  if (rebase.ok) return;
  await tryGit(worktreeRoot, ["rebase", "--abort"]);
  throw new AppError("merge_conflict", `Rebase onto ${base} hit conflicts.`);
}

async function fastForwardBase({ mainRoot, branch }: WorktreeFacts): Promise<"merged" | "base_moved"> {
  const merge = await tryGit(mainRoot, ["merge", "--ff-only", localRef(branch)]);
  if (merge.ok) return "merged";
  if (NOT_FAST_FORWARD.test(merge.stderr + merge.stdout)) return "base_moved";
  throw new AppError("base_dirty", failureMessage(merge));
}

export async function mergeIntoBase(facts: WorktreeFacts): Promise<string> {
  await requireCleanWorktree(facts);
  await requireBaseCheckedOut(facts);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await rebaseOntoBase(facts);
    if ((await fastForwardBase(facts)) === "merged") {
      return gitLine(facts.mainRoot, ["rev-parse", localRef(facts.base)]);
    }
  }
  throw new AppError("internal", `${facts.base} moved while merging. Try again.`);
}
