import type { Core } from "@pi-everywhere/protocol";
import type { ChangeEmitter } from "../change-emitter";
import type { CloneService } from "../git/clone-service";
import type { ProjectStore } from "../harness/project-store";
import type { SettingsStore } from "../home/settings-store";
import { notImplemented } from "../not-implemented";
import type { PresentProject } from "../project-view";
import type { RunGh } from "./run-gh";

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

export function createGithubService(_deps: GithubServiceDeps): GithubService {
  return {
    status: async () => ({ state: "not_installed" }),
    repos: async () => [],
    refreshRepos: async () => [],
    use: async () => {
      throw notImplemented("github.use");
    },
    extraGitConfig: () => [],
  };
}
