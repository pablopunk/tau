import { AppError, GithubRepoSchema } from "@pi-everywhere/protocol";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { checkGitUrl } from "../git/git-url";
import { REPOS_ARGS } from "./gh-commands";
import type { RunGh } from "./run-gh";

export interface RemoteRepo {
  readonly nameWithOwner: string;
  readonly description: string | null;
  readonly private: boolean;
  readonly pushedAt: number;
  readonly cloneUrl: string;
}

const ReposJsonSchema = Type.Array(
  Type.Object({
    full_name: Type.String(),
    private: Type.Boolean(),
    pushed_at: Type.Union([Type.String(), Type.Null()]),
    clone_url: Type.String(),
    ssh_url: Type.String(),
    description: Type.Union([Type.String(), Type.Null()]),
  }),
);

type RepoJson = Type.Static<typeof ReposJsonSchema>[number];

const unavailable = (message: string) => new AppError("github_unavailable", message);

const hasValidName = (repo: RepoJson) =>
  Value.Check(GithubRepoSchema.properties.nameWithOwner, repo.full_name);

const pushedAtOf = (repo: RepoJson) => (repo.pushed_at === null ? 0 : Date.parse(repo.pushed_at) || 0);

function toRemoteRepo(repo: RepoJson, gitProtocol: "https" | "ssh", allowLocalUrls: boolean) {
  const cloneUrl = gitProtocol === "ssh" ? repo.ssh_url : repo.clone_url;
  try {
    checkGitUrl(cloneUrl, allowLocalUrls);
  } catch {
    return [];
  }
  const remote: RemoteRepo = {
    nameWithOwner: repo.full_name,
    description: repo.description,
    private: repo.private,
    pushedAt: pushedAtOf(repo),
    cloneUrl,
  };
  return [remote];
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

async function runRepos(runGh: RunGh) {
  try {
    return await runGh(REPOS_ARGS);
  } catch {
    throw unavailable("GitHub could not be reached.");
  }
}

export async function fetchRepos(
  runGh: RunGh,
  gitProtocol: "https" | "ssh",
  allowLocalUrls: boolean,
): Promise<RemoteRepo[]> {
  const { stdout, stderr, exitCode } = await runRepos(runGh);
  if (exitCode !== 0) throw unavailable(stderr.trim().split("\n").at(-1) || "GitHub request failed.");
  const json = parseJson(stdout);
  if (!Value.Check(ReposJsonSchema, json)) throw unavailable("GitHub answered something unexpected.");
  return json
    .filter(hasValidName)
    .flatMap((repo) => toRemoteRepo(repo, gitProtocol, allowLocalUrls))
    .sort((a, b) => b.pushedAt - a.pushedAt);
}
