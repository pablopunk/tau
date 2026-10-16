import type { GithubRepo, Project } from "@pi-everywhere/protocol";
import { repositoryKey } from "../git/repository-key";
import type { RemoteRepo } from "./gh-repos";
import { type LocalScan, pickLocalCopy } from "./local-scan";

/** The key of the clone URL, and the key of the GitHub name (they differ for local test remotes). */
export const keysOfRepo = (repo: RemoteRepo): string[] => [
  ...new Set([repositoryKey(repo.cloneUrl), `github.com/${repo.nameWithOwner.toLowerCase()}`]),
];

export const repoNameOf = (repo: RemoteRepo) => repo.nameWithOwner.split("/")[1] ?? "";

export function localPathOf(repo: RemoteRepo, scan: LocalScan): string | null {
  const paths = keysOfRepo(repo).flatMap((key) => scan.copies.get(key) ?? []);
  return pickLocalCopy([...new Set(paths)], scan.root, repoNameOf(repo)) ?? null;
}

export function projectOfRepo(
  repo: RemoteRepo,
  localPath: string | null,
  projects: readonly Project[],
): Project | undefined {
  const keys = keysOfRepo(repo);
  return projects.find(
    (project) =>
      project.kind !== "home" &&
      ((project.gitUrl !== undefined && keys.includes(repositoryKey(project.gitUrl))) ||
        (localPath !== null && project.path === localPath)),
  );
}

export function toGithubRepo(repo: RemoteRepo, scan: LocalScan, projects: readonly Project[]): GithubRepo {
  const localPath = localPathOf(repo, scan);
  return {
    nameWithOwner: repo.nameWithOwner,
    description: repo.description,
    private: repo.private,
    pushedAt: repo.pushedAt,
    localPath,
    projectId: projectOfRepo(repo, localPath, projects)?.id ?? null,
  };
}
