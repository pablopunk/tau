import { defineDoc } from "@earendil-works/pi-durable";

export type ProjectRecord = {
  id: string;
  name: string;
  path: string;
  createdAt: number;
};

export const ProjectsDoc = defineDoc<{ projects: ProjectRecord[] }>({
  kind: "app.projects",
  version: 1,
  scope: "session",
  initial: () => ({ projects: [] }),
});
