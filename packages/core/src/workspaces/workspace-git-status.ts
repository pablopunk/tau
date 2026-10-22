import { AppError, type ConversationSummary, type WorkspaceStatus } from "@tau/protocol";
import { dirtyFilesOf, localRef } from "./repo-facts";
import { gitLine } from "./run-repo-command";

export type WorkspaceGitStatus = Pick<WorkspaceStatus, "ahead" | "behind" | "dirtyFiles">;

export const workspaceStatusKey = ({ path, branch, base }: ConversationSummary["workspace"]): string =>
  JSON.stringify([path, branch, base]);

export async function readWorkspaceGitStatus(
  workspace: ConversationSummary["workspace"],
): Promise<WorkspaceGitStatus> {
  const { path, branch, base } = workspace;
  if (branch === null || base === null) throw new AppError("internal", "The worktree is missing on disk.");
  const [counts, dirtyFiles] = await Promise.all([
    gitLine(path, ["rev-list", "--left-right", "--count", `${localRef(base)}...${localRef(branch)}`, "--"]),
    dirtyFilesOf(path),
  ]);
  const [behind, ahead] = counts.split(/\s+/).map(Number);
  if (ahead === undefined || behind === undefined || !Number.isFinite(ahead) || !Number.isFinite(behind)) {
    throw new AppError("internal", "Git returned invalid commit counts.");
  }
  return { ahead, behind, dirtyFiles };
}

export function workspaceStatusOf(thread: ConversationSummary, facts: WorkspaceGitStatus): WorkspaceStatus {
  const { ahead, behind, dirtyFiles } = facts;
  const reason =
    thread.status === "running"
      ? "The thread is running."
      : dirtyFiles.length > 0
        ? "The worktree has uncommitted changes."
        : thread.workspace.state === "merged" && ahead === 0
          ? "Already merged."
          : null;
  return {
    ahead,
    behind,
    dirtyFiles: [...dirtyFiles],
    unmergedCommits: ahead,
    canMerge: reason === null,
    reason,
  };
}
