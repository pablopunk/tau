import { AppError, type GithubStatus } from "@pi-everywhere/protocol";
import type { SettingsStore } from "../home/settings-store";
import { fetchRepos, type RemoteRepo } from "./gh-repos";
import { type LocalScan, scanLocalRepos } from "./local-scan";
import type { RunGh } from "./run-gh";

export const REPOS_TTL_MS = 5 * 60_000;

export interface RepoSnapshot {
  readonly remotes: readonly RemoteRepo[];
  readonly scan: LocalScan;
}

export interface RepoSource {
  /** Cached for five minutes. */
  get(): Promise<RepoSnapshot>;
  /** Bypasses the cache; shares the fetch that is already in flight. */
  refresh(): Promise<RepoSnapshot>;
}

export interface RepoSourceDeps {
  readonly runGh: RunGh;
  readonly status: () => Promise<GithubStatus>;
  readonly settings: SettingsStore;
  readonly homeDirectory: string;
  readonly now: () => number;
  readonly allowLocalUrls: boolean;
}

async function requireProtocol(status: () => Promise<GithubStatus>) {
  const current = await status();
  if (current.state !== "connected") {
    throw new AppError("github_unavailable", "GitHub is not connected. Check the GitHub CLI in settings.");
  }
  return current.gitProtocol;
}

export function createRepoSource(deps: RepoSourceDeps): RepoSource {
  let cached: { at: number; value: RepoSnapshot } | undefined;
  let inFlight: Promise<RepoSnapshot> | undefined;

  const load = async (): Promise<RepoSnapshot> => {
    const protocol = await requireProtocol(deps.status);
    const { projectsFolder } = await deps.settings.get();
    const [remotes, scan] = await Promise.all([
      fetchRepos(deps.runGh, protocol, deps.allowLocalUrls),
      scanLocalRepos(projectsFolder, deps.homeDirectory),
    ]);
    return { remotes, scan };
  };

  const startLoad = () => {
    inFlight ??= load()
      .then((value) => {
        cached = { at: deps.now(), value };
        return value;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };

  return {
    get: async () => {
      if (cached && deps.now() - cached.at < REPOS_TTL_MS) return cached.value;
      return startLoad();
    },
    refresh: async () => startLoad(),
  };
}
