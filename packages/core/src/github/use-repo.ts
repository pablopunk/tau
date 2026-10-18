import { randomUUID } from "node:crypto";
import { AppError, type Project, type UseGithubRepoInput } from "@tau/protocol";
import type { ChangeEmitter } from "../change-emitter";
import type { CloneService } from "../git/clone-service";
import { repositoryKey } from "../git/repository-key";
import type { ProjectStore } from "../harness/project-store";
import type { PresentProject } from "../project-view";
import { resolveProjectFolder } from "../resolve-project-folder";
import type { RemoteRepo } from "./gh-repos";
import type { LocalScan } from "./local-scan";
import { readRemoteUrls } from "./remotes";
import { keysOfRepo, localPathOf, projectOfRepo, repoNameOf } from "./repo-view";

export interface UseRepoDeps {
  readonly projects: ProjectStore;
  readonly clones: CloneService;
  readonly changes: ChangeEmitter;
  readonly now: () => number;
  readonly presentProject: PresentProject;
}

export type UseRepo = (input: UseGithubRepoInput, repo: RemoteRepo, scan: LocalScan) => Promise<Project>;

const needsFolder = () =>
  new AppError("needs_folder", "There is no local copy of this repository. Clone it or pick a folder.");

const remoteMismatch = () =>
  new AppError("remote_mismatch", "This folder is a copy of a different repository.");

async function requireMatchingRemotes(path: string, repo: RemoteRepo) {
  const remotes = await readRemoteUrls(path);
  const keys = keysOfRepo(repo);
  if (remotes.length > 0 && !remotes.some((url) => keys.includes(repositoryKey(url)))) throw remoteMismatch();
}

export function createUseRepo(deps: UseRepoDeps): UseRepo {
  const { projects, clones, changes, now, presentProject } = deps;

  const addFolderProject = async (path: string, repo: RemoteRepo) => {
    const project = await projects.add({
      id: randomUUID(),
      name: repoNameOf(repo),
      path,
      createdAt: now(),
      gitUrl: repo.cloneUrl,
    });
    changes.emit({ resource: "projects" });
    return project;
  };

  const useLocal = async (repo: RemoteRepo, scan: LocalScan) => {
    const path = localPathOf(repo, scan);
    if (path === null) throw needsFolder();
    return addFolderProject(path, repo);
  };

  const useFolder = async (path: string | undefined, repo: RemoteRepo) => {
    if (path === undefined) throw new AppError("invalid_request", "Pick a folder for this repository.");
    const real = await resolveProjectFolder(path);
    const sameFolder = (await projects.list()).find((project) => project.path === real);
    if (sameFolder) return sameFolder;
    await requireMatchingRemotes(real, repo);
    return addFolderProject(real, repo);
  };

  return async (input, repo, scan) => {
    const existing = projectOfRepo(repo, localPathOf(repo, scan), await projects.list());
    if (existing) return presentProject(existing);
    if (input.mode === "clone" && localPathOf(repo, scan) === null) {
      return presentProject(await clones.clone({ url: repo.cloneUrl, name: repoNameOf(repo) }));
    }
    const project = input.mode !== "folder" ? await useLocal(repo, scan) : await useFolder(input.path, repo);
    return presentProject(project);
  };
}
