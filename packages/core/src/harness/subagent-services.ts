import type { ModelRef, Project } from "@tau/protocol";
import type { AgentTypeLoader } from "../agents/agent-types";
import type { ResolveModelAlias } from "../agents/model-alias";
import type { WorkspaceService } from "../workspaces/workspace-service";
import type { ToolServicesRef } from "./tools/tool-file";

export interface SubagentServices {
  readonly agentTypes: AgentTypeLoader;
  readonly resolveModelAlias: ResolveModelAlias;
  readonly fastModel: () => Promise<ModelRef | undefined>;
  readonly projectOf: (projectId: string) => Promise<Project>;
  readonly workspaces: Pick<WorkspaceService, "create" | "merge">;
}

export function subagentServicesOf(ref: ToolServicesRef): SubagentServices {
  return ref.current().subagents;
}
