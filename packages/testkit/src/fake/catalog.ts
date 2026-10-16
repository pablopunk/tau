import type { ModelInfo, ThinkingLevel } from "@pi-everywhere/protocol";

export const FAKE_PROVIDER_ID = "openrouter";

const REASONING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

export const FAKE_MODELS: readonly ModelInfo[] = [
  {
    provider: "faux",
    modelId: "faux-1",
    name: "Faux One",
    contextWindow: 128000,
    reasoning: true,
    images: true,
    thinkingLevels: REASONING_LEVELS,
  },
  {
    provider: "faux",
    modelId: "faux-2",
    name: "Faux Two",
    contextWindow: 128000,
    reasoning: false,
    images: true,
    thinkingLevels: ["off"],
  },
  {
    provider: "faux",
    modelId: "faux-fast",
    name: "Faux Fast",
    contextWindow: 128000,
    reasoning: false,
    images: true,
    thinkingLevels: ["off"],
  },
  {
    provider: "faux",
    modelId: "faux-text",
    name: "Faux Text",
    contextWindow: 128000,
    reasoning: false,
    images: false,
    thinkingLevels: ["off"],
  },
];

const LEVEL_ORDER: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function findFakeModel(ref: { provider: string; modelId: string }): ModelInfo | undefined {
  return FAKE_MODELS.find((model) => model.provider === ref.provider && model.modelId === ref.modelId);
}

/** The nearest supported level at or below the wanted one, as pi-ai's `clampThinkingLevel`. */
export function clampFakeThinkingLevel(model: ModelInfo, wanted: ThinkingLevel): ThinkingLevel {
  const candidates = LEVEL_ORDER.slice(0, LEVEL_ORDER.indexOf(wanted) + 1).reverse();
  return candidates.find((level) => model.thinkingLevels.includes(level)) ?? "off";
}
