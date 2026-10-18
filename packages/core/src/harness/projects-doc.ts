import { defineDoc } from "@earendil-works/pi-durable";
import type { ProjectStatus } from "@tau/protocol";

export type ProjectRecord = {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  kind: "folder" | "git";
  status: ProjectStatus;
  gitUrl?: string;
  error?: string;
};

type ProjectsValue = { projects: ProjectRecord[] };

const withMvpDefaults = (record: ProjectRecord): ProjectRecord => ({
  ...record,
  kind: record.kind ?? "folder",
  status: record.status ?? "ready",
});

export const ProjectsDoc = defineDoc<ProjectsValue>({
  kind: "app.projects",
  version: 2,
  scope: "session",
  initial: () => ({ projects: [] }),
  migrate: (value) => {
    const { projects } = value as unknown as ProjectsValue;
    return { projects: projects.map(withMvpDefaults) };
  },
});
