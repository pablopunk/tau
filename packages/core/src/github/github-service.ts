import { homedir } from "node:os";
import { AppError, type Core, type GithubStatus, type Project } from "@pi-everywhere/protocol";
import type { ChangeEmitter } from "../change-emitter";
import type { CloneService } from "../git/clone-service";
import type { ProjectStore } from "../harness/project-store";
import type { SettingsStore } from "../home/settings-store";
import type { PresentProject } from "../project-view";
import { credentialHelperArgs } from "./credential-config";
import { readGithubStatus } from "./gh-status";
import { createRepoSource } from "./repo-source";
import { toGithubRepo } from "./repo-view";
import type { RunGh } from "./run-gh";
import { createUseRepo } from "./use-repo";

export const STATUS_TTL_MS = 60_000;

export interface GithubServiceDeps {
  readonly runGh: RunGh;
  /** Absolute path of `gh` found at startup; `undefined` when it is not on the PATH. */
  readonly ghPath: string | undefined;
  readonly projects: ProjectStore;
  readonly clones: CloneService;
  readonly settings: SettingsStore;
  readonly changes: ChangeEmitter;
  readonly now: () => number;
  /** Fills `iconUrl`; every `Project` that leaves the core goes through it. */
  readonly presentProject: PresentProject;
}

export type GithubService = Core["github"] & {
  /** `git` arguments that let a private https clone use gh's credential helper; none when not applicable. */
  extraGitConfig(url: string): string[];
};

const allowsLocalUrls = () => process.env.PI_EVERYWHERE_ALLOW_FILE_CLONES === "1";

function createStatusCache(deps: GithubServiceDeps) {
  let cached: { at: number; value: Promise<GithubStatus> } | undefined;
  let connected = false;
  const status = (): Promise<GithubStatus> => {
    if (cached && deps.now() - cached.at < STATUS_TTL_MS) return cached.value;
    const value = readGithubStatus(deps.runGh).then((result) => {
      connected = result.state === "connected";
      return result;
    });
    cached = { at: deps.now(), value };
    return value;
  };
  return { status, isConnected: () => connected };
}

export function createGithubService(deps: GithubServiceDeps): GithubService {
  const { projects, ghPath } = deps;
  const { status, isConnected } = createStatusCache(deps);
  const source = createRepoSource({
    runGh: deps.runGh,
    status,
    settings: deps.settings,
    homeDirectory: homedir(),
    now: deps.now,
    allowLocalUrls: allowsLocalUrls(),
  });
  const useRepo = createUseRepo(deps);
  const inFlight = new Map<string, Promise<Project>>();

  const view = async (load: () => ReturnType<typeof source.get>) => {
    const { remotes, scan } = await load();
    const current = await projects.list();
    return remotes.map((repo) => toGithubRepo(repo, scan, current));
  };

  const useOnce = async (input: Parameters<GithubService["use"]>[0]) => {
    const { remotes, scan } = await source.get();
    const repo = remotes.find(
      (item) => item.nameWithOwner.toLowerCase() === input.nameWithOwner.toLowerCase(),
    );
    if (!repo) throw new AppError("not_found", "This repository is not in your GitHub list.");
    return useRepo(input, repo, scan);
  };

  void status();

  return {
    status,
    repos: () => view(source.get),
    refreshRepos: () => view(source.refresh),
    use(input) {
      const key = input.nameWithOwner.toLowerCase();
      const running = inFlight.get(key) ?? useOnce(input);
      inFlight.set(key, running);
      return running.finally(() => {
        if (inFlight.get(key) === running) inFlight.delete(key);
      });
    },
    extraGitConfig: (url) => credentialHelperArgs(url, ghPath, isConnected()),
  };
}
