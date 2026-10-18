import type { ModelRef, Project, ThinkingLevel } from "@tau/protocol";
import type { AgentTypeLoader } from "../agents/agent-types";
import type { ResolveModelAlias } from "../agents/model-alias";
import type { WorkspaceService } from "../workspaces/workspace-service";
import type { ConnectorOffering } from "./connector-offering";
import type { ToolServicesRef } from "./tools/tool-file";

export interface SubagentServices {
  readonly agentTypes: AgentTypeLoader;
  readonly resolveModelAlias: ResolveModelAlias;
  readonly fastModel: () => Promise<ModelRef | undefined>;
  readonly clampThinking: (model: ModelRef, level: ThinkingLevel) => ThinkingLevel;
  readonly projectOf: (projectId: string) => Promise<Project>;
  readonly removeSubagent: (id: string, force: boolean) => Promise<void>;
  readonly workspaces: Pick<WorkspaceService, "create" | "merge">;
  readonly connectorOffering?: Pick<ConnectorOffering, "modelToolsFor">;
}

export function subagentServicesOf(ref: ToolServicesRef): SubagentServices {
  return ref.current().subagents;
}
