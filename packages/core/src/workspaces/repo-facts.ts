import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { git, gitLine, tryGit } from "./run-repo-command";

export interface RepoLocation {
  readonly root: string;
  readonly subpath: string;
}

export async function locateRepo(path: string): Promise<RepoLocation | undefined> {
  const top = await tryGit(path, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return undefined;
  const prefix = await gitLine(path, ["rev-parse", "--show-prefix"]);
  return { root: await realpath(top.stdout.trim()), subpath: prefix.replace(/\/$/, "") };
}

export async function mainCheckoutRoot(worktreePath: string): Promise<string> {
  const listing = await git(worktreePath, ["worktree", "list", "--porcelain"]);
  const first = listing.split("\n")[0] ?? "";
  return realpath(first.replace(/^worktree /, ""));
}

export async function currentBranch(path: string): Promise<string | undefined> {
  const result = await tryGit(path, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const branch = result.stdout.trim();
  return result.ok && branch !== "" ? branch : undefined;
}

export async function hasCommits(path: string): Promise<boolean> {
  return (await tryGit(path, ["rev-parse", "--verify", "-q", "HEAD"])).ok;
}

export async function branchExists(root: string, branch: string): Promise<boolean> {
  return (await tryGit(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).ok;
}

export async function dirtyFilesOf(path: string): Promise<string[]> {
  const output = await git(path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  return output
    .split("\0")
    .filter((entry) => entry.length > 3)
    .map((entry) => entry.slice(3));
}

export async function countCommits(path: string, range: string): Promise<number> {
  return Number(await gitLine(path, ["rev-list", "--count", range, "--"]));
}

export const inWorktree = (worktreeRoot: string, subpath: string) =>
  subpath === "" ? worktreeRoot : join(worktreeRoot, subpath);

export const localRef = (branch: string) => `refs/heads/${branch}`;
