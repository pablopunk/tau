import { clampThinkingLevel } from "@earendil-works/pi-ai/models";
import type { ModelRef, ThinkingLevel } from "@tau/protocol";

type ModelLookup = {
  getModel(provider: string, modelId: string): Parameters<typeof clampThinkingLevel>[0] | undefined;
};

export function clampThinkingFor(models: ModelLookup, ref: ModelRef, level: ThinkingLevel): ThinkingLevel {
  const model = models.getModel(ref.provider, ref.modelId);
  return model ? clampThinkingLevel(model, level) : level;
}

export const THINKING_GUIDANCE =
  'Use the effort the user asked for in this conversation (for example "Sonnet with low effort"); otherwise leave it out and the subagent inherits yours.';
