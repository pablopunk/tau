import type { Project, ThreadWorkspace } from "@pi-everywhere/protocol";
import type { SubagentServices } from "../subagent-services";

export const NOT_GIT_MESSAGE =
  'isolation "worktree" needs a project inside a git repository. Run the subagent without isolation.';

export async function createIsolatedWorkspace(
  services: SubagentServices,
  project: Project,
  callId: string,
  description: string,
): Promise<ThreadWorkspace> {
  if (!project.isGitRepo || project.kind === "home") throw new Error(NOT_GIT_MESSAGE);
  return services.workspaces.create({
    project,
    mode: "worktree",
    requestId: `agent:${callId}`,
    firstMessage: description,
  });
}
