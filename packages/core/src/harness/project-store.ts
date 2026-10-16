import type { Harness } from "@earendil-works/pi-durable";
import { AppError, type Project } from "@pi-everywhere/protocol";
import { INDEX_SEED, ProjectIndexDoc, type ProjectRecord, ProjectsDoc } from "./app-docs";
import { BACKGROUND } from "./open";

const toProject = ({ id, name, path, createdAt }: ProjectRecord): Project => ({ id, name, path, createdAt });

const notFound = () => new AppError("not_found", "Project not found.");

export interface ProjectStore {
  list(): Promise<Project[]>;
  find(id: string): Promise<Project | undefined>;
  require(id: string): Promise<Project>;
  /** `path` must already be a real path; rejects `duplicate_project` for a path that is already a project. */
  add(input: { id: string; name: string; path: string; createdAt: number }): Promise<Project>;
  rename(id: string, name: string): Promise<void>;
  /** Drops the project and empties its conversation index in one commit. */
  remove(id: string): Promise<void>;
}

export function createProjectStore(harness: Harness): ProjectStore {
  const list = async () => ((await harness.snapshot(ProjectsDoc, BACKGROUND))?.projects ?? []).map(toProject);
  const find = async (id: string) => (await list()).find((project) => project.id === id);
  return {
    list,
    find,
    async require(id) {
      const project = await find(id);
      if (!project) throw notFound();
      return project;
    },
    add: (input) =>
      harness.commit(async (tx) => {
        const doc = await tx.doc(ProjectsDoc);
        if (doc.projects.some((project) => project.path === input.path)) {
          throw new AppError("duplicate_project", "This folder is already a project.");
        }
        doc.projects.push({ ...input });
        return toProject(input);
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
        const index = await tx.doc(ProjectIndexDoc, id, INDEX_SEED);
        index.conversations.splice(0, index.conversations.length);
      }, BACKGROUND),
  };
}
