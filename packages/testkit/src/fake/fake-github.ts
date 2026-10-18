import { AppError, type Core, type GithubRepo, type GithubStatus, type Project } from "@tau/protocol";
import { assertDirectory, type FakeFs } from "./fake-fs";

export type FakeGithubRepo = Omit<GithubRepo, "projectId">;

export interface FakeGithubOptions {
  readonly status?: GithubStatus;
  /** Most recently pushed first is not required: the fake sorts. */
  readonly repos?: readonly FakeGithubRepo[];
}

export const FAKE_GITHUB_STATUS: GithubStatus = {
  state: "connected",
  login: "demo",
  gitProtocol: "https",
  tokenSource: "keyring",
};

const HOUR_MS = 3_600_000;

export const fakeGithubRepos = (now: number): FakeGithubRepo[] => [
  {
    nameWithOwner: "demo/tau",
    description: "Chat with a coding agent",
    private: false,
    pushedAt: now - HOUR_MS,
    localPath: "/Users/demo/src/tau",
  },
  {
    nameWithOwner: "demo/api-server",
    description: null,
    private: true,
    pushedAt: now - 30 * HOUR_MS,
    localPath: null,
  },
  {
    nameWithOwner: "demo/dotfiles",
    description: null,
    private: false,
    pushedAt: now - 400 * HOUR_MS,
    localPath: null,
  },
];

export interface FakeGithubDeps {
  readonly options: FakeGithubOptions;
  readonly now: () => number;
  readonly fs: FakeFs;
  readonly projects: () => Project[];
  readonly addFolderProject: (input: { path: string; name?: string; gitUrl: string }) => Project;
  readonly cloneProject: (input: { url: string }) => Project;
}

const cloneUrlOf = (nameWithOwner: string) => `https://github.com/${nameWithOwner}.git`;
const keyOf = (url: string) =>
  url
    .replace(/^(?:https:\/\/|ssh:\/\/git@|git@)github\.com[/:]/i, "")
    .replace(/\.git$/, "")
    .toLowerCase();

export function createFakeGithub(deps: FakeGithubDeps): Core["github"] {
  const status = deps.options.status ?? FAKE_GITHUB_STATUS;
  const repoList = deps.options.repos ?? fakeGithubRepos(deps.now());
  const requireConnected = () => {
    if (status.state !== "connected") throw new AppError("github_unavailable", "GitHub is not connected.");
  };
  const projectOf = (nameWithOwner: string) =>
    deps
      .projects()
      .find((project) => project.gitUrl && keyOf(project.gitUrl) === nameWithOwner.toLowerCase());
  const list = (): GithubRepo[] => {
    requireConnected();
    return [...repoList]
      .sort((a, b) => b.pushedAt - a.pushedAt)
      .map((repo) => ({ ...repo, projectId: projectOf(repo.nameWithOwner)?.id ?? null }));
  };
  return {
    async status() {
      return { ...status };
    },
    async repos() {
      return list();
    },
    async refreshRepos() {
      return list();
    },
    async use({ nameWithOwner, mode, path }) {
      requireConnected();
      const repo = repoList.find((candidate) => candidate.nameWithOwner === nameWithOwner);
      if (!repo) throw new AppError("not_found", `Unknown repository: ${nameWithOwner}`);
      const existing = projectOf(nameWithOwner);
      if (existing) return { ...existing };
      const gitUrl = cloneUrlOf(nameWithOwner);
      if (mode === "clone") return deps.cloneProject({ url: gitUrl });
      if (mode === "local") {
        if (!repo.localPath) throw new AppError("needs_folder", "There is no local copy of this repository.");
        return deps.addFolderProject({ path: repo.localPath, gitUrl });
      }
      if (!path) throw new AppError("invalid_request", "Choose a folder.");
      return deps.addFolderProject({ path: assertDirectory(deps.fs, path), gitUrl });
    },
  };
}
