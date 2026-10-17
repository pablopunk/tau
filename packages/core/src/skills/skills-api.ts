import type { Core } from "@pi-everywhere/protocol";
import type { ProjectStore } from "../harness/project-store";
import { discoverSkills } from "./discover-skills";

export { discoverSkills };

export function createSkillsApi(deps: { projects: ProjectStore }): Core["skills"] {
  return {
    async list(projectId) {
      const project = projectId === null ? undefined : await deps.projects.require(projectId);
      return discoverSkills(project?.path ?? null);
    },
  };
}
