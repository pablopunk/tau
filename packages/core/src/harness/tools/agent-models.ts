import type { ModelRef } from "@tau/protocol";
import { THINKING_GUIDANCE } from "./agent-thinking";

export const MODEL_LIST_CAP = 40;

export const modelName = (model: ModelRef) => `${model.provider}/${model.modelId}`;

export function parentProviderFirst(models: readonly ModelRef[], parent: ModelRef | undefined) {
  const own = models.filter((model) => model.provider === parent?.provider);
  const others = models.filter((model) => model.provider !== parent?.provider);
  return [...own, ...others];
}

export function connectedModelLines(models: readonly ModelRef[], parent: ModelRef | undefined): string[] {
  const ordered = parentProviderFirst(models, parent).slice(0, MODEL_LIST_CAP);
  const hidden = models.length - ordered.length;
  const lines = ordered.map((model) => `- ${modelName(model)}`);
  return hidden > 0 ? [...lines, `- ... and ${hidden} more`] : lines;
}

export function modelsGuidance(models: readonly ModelRef[], parent: ModelRef | undefined): string {
  return [
    `Subagent models: a subagent uses your model (${parent ? modelName(parent) : "unknown"}) unless you pass \`model\` to the agent tool. Pick another one only when the user asked for it in this conversation, for example "use DeepSeek for the workers".`,
    `Subagent effort: ${THINKING_GUIDANCE}`,
    "Connected models:",
    ...connectedModelLines(
      parent ? models.filter((model) => model.provider === parent.provider) : models,
      parent,
    ),
  ].join("\n");
}
