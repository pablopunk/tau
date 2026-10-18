import { type Project, projectIconUrl } from "@tau/protocol";
import { HOME_PROJECT_ID } from "./harness/project-store";
import type { SettingsStore } from "./home/settings-store";
import type { IconService } from "./icons/icon-service";
import { createGitRepoProbe } from "./workspaces/git-repo-probe";

export type PresentProject = (project: Project) => Promise<Project>;

/** Adds `iconUrl`: always set for a real project (the GET answers 404 without an icon), `null` for Home and while a project is cloning or failed. */
const hasIcon = (project: Project) => project.id !== HOME_PROJECT_ID && project.status === "ready";

export function createPresentProject(icons: IconService, settings: SettingsStore): PresentProject {
  const probe = createGitRepoProbe();
  const isGitRepo = async (project: Project) =>
    project.id !== HOME_PROJECT_ID && project.status === "ready" && (await probe.isGitRepo(project.path));
  const lastModeOf = async (projectId: string) => {
    const lastWorkspaceMode = await settings.lastWorkspaceMode(projectId);
    return lastWorkspaceMode ? { lastWorkspaceMode } : {};
  };
  return async (project) => ({
    ...(await lastModeOf(project.id)),
    ...project,
    isGitRepo: await isGitRepo(project),
    iconUrl: hasIcon(project) ? projectIconUrl(project.id, await icons.version(project.id)) : null,
  });
}
