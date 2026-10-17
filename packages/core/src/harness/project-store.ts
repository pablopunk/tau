import { homedir } from "node:os";
import type { Harness } from "@earendil-works/pi-durable";
import { AppError, type Project } from "@pi-everywhere/protocol";
import { repositoryKey } from "../git/repository-key";
import { createGitRepoProbe, type GitRepoProbe } from "../workspaces/git-repo-probe";
import { BACKGROUND } from "./open";
import { type ProjectRecord, ProjectsDoc } from "./projects-doc";

export const HOME_PROJECT_ID = "home";

const homeProject = (): Project => ({
  id: HOME_PROJECT_ID,
  name: "Home",
  path: homedir(),
  createdAt: 0,
  kind: "home",
  status: "ready",
  isGitRepo: false,
});

const toProject = (
  { id, name, path, createdAt, kind, status, gitUrl, error }: ProjectRecord,
  isGitRepo: boolean,
): Project => ({
  id,
  name,
  path,
  createdAt,
  kind,
  status,
  isGitRepo,
  ...(gitUrl === undefined ? {} : { gitUrl }),
  ...(error === undefined ? {} : { error }),
});

export type ProjectUpdate = { status: "cloning" | "ready" | "failed"; path?: string; error?: string };

const duplicateProject = () => new AppError("duplicate_project", "This project already exists.");

const hasRepository = (records: readonly ProjectRecord[], key: string) =>
  records.some((record) => record.gitUrl !== undefined && repositoryKey(record.gitUrl) === key);

const notFound = () => new AppError("not_found", "Project not found.");

export interface ProjectStore {
  /** Home first, then creation order. */
  list(): Promise<Project[]>;
  find(id: string): Promise<Project | undefined>;
  require(id: string): Promise<Project>;
  /**
   * `path` must already be a real path; rejects `duplicate_project` for a path that is already a project, or for a
   * `gitUrl` with the same `repositoryKey` as another project's.
   */
  add(input: {
    id: string;
    name: string;
    path: string;
    createdAt: number;
    gitUrl?: string;
  }): Promise<Project>;
  /** A project that is being cloned; rejects `duplicate_project` for the same normalized URL. */
  addGit(input: {
    id: string;
    name: string;
    path: string;
    createdAt: number;
    gitUrl: string;
  }): Promise<Project>;
  /** Replaces status, error and optionally path; resolves false when the project no longer exists. */
  setCloneState(id: string, update: ProjectUpdate): Promise<boolean>;
  rename(id: string, name: string): Promise<void>;
  /** Drops the project record only; its conversations go through `ConversationStore.removeAllOfProject`. */
  remove(id: string): Promise<void>;
}

export function createProjectStore(
  harness: Harness,
  probe: GitRepoProbe = createGitRepoProbe(),
): ProjectStore {
  const present = async (record: ProjectRecord) =>
    toProject(record, record.status === "ready" && (await probe.isGitRepo(record.path)));
  const stored = async () => (await harness.snapshot(ProjectsDoc, BACKGROUND))?.projects ?? [];
  const list = async () => [homeProject(), ...(await Promise.all((await stored()).map(present)))];
  const find = async (id: string) => (await list()).find((project) => project.id === id);
  return {
    list,
    find,
    async require(id) {
      const project = await find(id);
      if (!project) throw notFound();
      return project;
    },
    add: async (input) => {
      const found = await probe.isGitRepo(input.path);
      return harness.commit(async (tx) => {
        const doc = await tx.doc(ProjectsDoc);
        if (input.path === homedir() || doc.projects.some((project) => project.path === input.path)) {
          throw new AppError("duplicate_project", "This folder is already a project.");
        }
        if (input.gitUrl !== undefined && hasRepository(doc.projects, repositoryKey(input.gitUrl))) {
          throw duplicateProject();
        }
        const record: ProjectRecord = { ...input, kind: "folder", status: "ready" };
        doc.projects.push(record);
        return toProject(record, found);
      }, BACKGROUND);
    },
    addGit: (input) =>
      harness.commit(async (tx) => {
        const doc = await tx.doc(ProjectsDoc);
        const taken =
          doc.projects.some((project) => project.path === input.path) ||
          hasRepository(doc.projects, repositoryKey(input.gitUrl));
        if (taken) throw duplicateProject();
        const record: ProjectRecord = { ...input, kind: "git", status: "cloning" };
        doc.projects.push(record);
        return toProject(record, false);
      }, BACKGROUND),
    setCloneState: (id, update) =>
      harness.commit(async (tx) => {
        const project = (await tx.doc(ProjectsDoc)).projects.find((candidate) => candidate.id === id);
        if (!project) return false;
        project.status = update.status;
        if (update.path !== undefined) project.path = update.path;
        if (update.error === undefined) delete project.error;
        else project.error = update.error;
        return true;
      }, BACKGROUND),
    rename: (id, name) =>
      harness.commit(async (tx) => {
        const project = (await tx.doc(ProjectsDoc)).projects.find((candidate) => candidate.id === id);
        if (!project) throw notFound();
        project.name = name;
      }, BACKGROUND),
    remove: (id) =>
      harness.commit(async (tx) => {
        const { projects } = await tx.doc(ProjectsDoc);
        const position = projects.findIndex((candidate) => candidate.id === id);
        if (position < 0) throw notFound();
        projects.splice(position, 1);
      }, BACKGROUND),
  };
}
