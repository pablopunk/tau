import type { Core, Skill } from "@pi-everywhere/protocol";
import type { ProjectStore } from "../harness/project-store";

/** Frozen shape; Phase 1 (B) scans the project and user skill folders. */
export async function discoverSkills(_projectFolder: string | null): Promise<Skill[]> {
  return [];
}

export function createSkillsApi(deps: { projects: ProjectStore }): Core["skills"] {
  return {
    async list(projectId) {
      const project = projectId === null ? undefined : await deps.projects.require(projectId);
      return discoverSkills(project?.path ?? null);
    },
  };
}
