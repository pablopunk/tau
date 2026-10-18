import type { AgentState, ConversationView, ModelInfo, ThinkingLevel } from "@tau/protocol";

export interface AgentInfo {
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: ThinkingLevel;
}

export function readAgent(view: ConversationView): AgentInfo {
  const agent = view.docs["pi.agent"] as unknown as Partial<AgentState> | undefined;
  return {
    provider: agent?.model?.provider,
    modelId: agent?.model?.modelId,
    thinkingLevel: (agent?.thinkingLevel as ThinkingLevel | undefined) ?? "off",
  };
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
