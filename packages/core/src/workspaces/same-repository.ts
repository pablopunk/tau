import { access } from "node:fs/promises";
import { AppError, type ConversationSummary, type Project } from "@tau/protocol";
import { repositoryKey } from "../git/repository-key";
import { readRemoteUrls } from "../github/remotes";
import { branchExists } from "./repo-facts";
import { tryGit } from "./run-repo-command";

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const isRepo = async (path: string) => (await tryGit(path, ["rev-parse", "--git-dir"])).ok;

const remoteKeys = async (path: string) => new Set((await readRemoteUrls(path)).map(repositoryKey));

const rootCommits = async (path: string) => {
  const result = await tryGit(path, ["rev-list", "--max-parents=0", "HEAD"]);
  return new Set(result.ok ? result.stdout.split("\n").filter((line) => line !== "") : []);
};

const intersects = (a: ReadonlySet<string>, b: ReadonlySet<string>) => [...a].some((item) => b.has(item));

async function matchesLiveFolder(oldPath: string, newPath: string) {
  if (!(await isRepo(oldPath))) return true;
  const [oldRemotes, newRemotes] = await Promise.all([remoteKeys(oldPath), remoteKeys(newPath)]);
  if (oldRemotes.size > 0 && newRemotes.size > 0) return intersects(oldRemotes, newRemotes);
  return intersects(await rootCommits(oldPath), await rootCommits(newPath));
}

async function hasEveryWorktreeBranch(newPath: string, threads: readonly ConversationSummary[]) {
  const branches = threads.map((thread) => thread.workspace.branch).filter((branch) => branch !== null);
  const found = await Promise.all(branches.map((branch) => branchExists(newPath, branch)));
  return found.every(Boolean);
}

async function matchesMovedFolder(
  project: Project,
  newPath: string,
  threads: readonly ConversationSummary[],
) {
  if (project.gitUrl !== undefined) return (await remoteKeys(newPath)).has(repositoryKey(project.gitUrl));
  return hasEveryWorktreeBranch(newPath, threads);
}

export async function requireSameRepository(
  project: Project,
  newPath: string,
  worktreeThreads: readonly ConversationSummary[],
): Promise<void> {
  const oldExists = await exists(project.path);
  const wasRepo = project.isGitRepo || project.gitUrl !== undefined || worktreeThreads.length > 0;
  if (!wasRepo && !oldExists) return;
  if (!(await isRepo(newPath))) throw new AppError("invalid_request", "This folder is not a git repository.");
  const same = oldExists
    ? await matchesLiveFolder(project.path, newPath)
    : await matchesMovedFolder(project, newPath, worktreeThreads);
  if (!same) {
    throw new AppError("invalid_request", "This folder is not the same repository as the project.");
  }
}
