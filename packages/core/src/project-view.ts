import { type Project, projectIconUrl } from "@pi-everywhere/protocol";
import { HOME_PROJECT_ID } from "./harness/project-store";
import type { IconService } from "./icons/icon-service";

export type PresentProject = (project: Project) => Promise<Project>;

/** Adds `iconUrl`: always set for a real project (the GET answers 404 without an icon), `null` for Home and while a project is cloning or failed. */
const hasIcon = (project: Project) => project.id !== HOME_PROJECT_ID && project.status === "ready";

export function createPresentProject(icons: IconService): PresentProject {
  return async (project) => ({
    ...project,
    iconUrl: hasIcon(project) ? projectIconUrl(project.id, await icons.version(project.id)) : null,
  });
}
