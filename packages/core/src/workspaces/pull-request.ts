import { AppError } from "@tau/protocol";
import { readGithubStatus } from "../github/gh-status";
import type { RunGh } from "../github/run-gh";
import { localRef } from "./repo-facts";
import { git, tryGit } from "./run-repo-command";
import type { WorktreeFacts } from "./worktree-facts";

const GITHUB_REMOTE = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;

export async function requireGithubConnected(runGh: RunGh | undefined): Promise<RunGh> {
  const status = runGh ? await readGithubStatus(runGh) : undefined;
  if (!runGh || status?.state !== "connected") {
    throw new AppError("github_unavailable", "Connect GitHub to create pull requests.");
  }
  return runGh;
}

async function repositoryOf({ mainRoot }: WorktreeFacts): Promise<string> {
  const url = (await tryGit(mainRoot, ["remote", "get-url", "origin"])).stdout.trim();
  const match = GITHUB_REMOTE.exec(url);
  if (!match) throw new AppError("invalid_request", "The origin remote is not a GitHub repository.");
  return `${match[1]}/${match[2]}`;
}

async function pushBranch({ worktreeRoot, branch }: WorktreeFacts): Promise<void> {
  await git(worktreeRoot, ["push", "--set-upstream", "origin", `${localRef(branch)}:${localRef(branch)}`]);
}

const urlIn = (stdout: string) => stdout.split(/\s+/).find((word) => word.startsWith("https://"));

export async function openPullRequest(runGh: RunGh, facts: WorktreeFacts, title: string): Promise<string> {
  const repository = await repositoryOf(facts);
  await pushBranch(facts);
  const result = await runGh([
    "pr",
    "create",
    "--repo",
    repository,
    "--head",
    facts.branch,
    "--base",
    facts.base,
    "--title",
    title,
    "--body",
    "",
  ]);
  const url = urlIn(result.stdout);
  if (result.exitCode !== 0 || url === undefined) {
    throw new AppError("internal", result.stderr.trim() || "gh could not create the pull request.");
  }
  return url;
}
