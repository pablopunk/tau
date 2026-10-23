import type { AgentInfo, ConversationView, ModelInfo } from "@tau/protocol";
import { agentInfoOf } from "@tau/protocol";

export type { AgentInfo };

export function readAgent(view: ConversationView): AgentInfo {
  return agentInfoOf(view);
}

export function findModel(agent: AgentInfo, models: readonly ModelInfo[] | undefined): ModelInfo | undefined {
  return models?.find((model) => model.provider === agent.provider && model.modelId === agent.modelId);
}

export function imagesAllowedFor(
  view: ConversationView | undefined,
  models: readonly ModelInfo[] | undefined,
) {
  if (!view) return true;
  return findModel(readAgent(view), models)?.images ?? true;
}
