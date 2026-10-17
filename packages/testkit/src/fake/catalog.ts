import type { ModelInfo, ProviderInfo, ThinkingLevel } from "@pi-everywhere/protocol";

export const FAKE_PROVIDERS: readonly Omit<ProviderInfo, "connection">[] = [
  { id: "openrouter", name: "OpenRouter", methods: ["api_key"], keyUrl: "https://openrouter.ai/keys" },
  {
    id: "openai",
    name: "OpenAI",
    methods: ["api_key", "chatgpt"],
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    methods: ["api_key"],
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  { id: "google", name: "Google", methods: ["api_key"], keyUrl: "https://aistudio.google.com/apikey" },
  { id: "opencode", name: "OpenCode", methods: ["api_key"], keyUrl: "https://opencode.ai/auth" },
];

export const FAKE_AUTH_URL = "https://auth.fake.test/authorize?state=faux";
export const FAKE_VALID_CALLBACK_URL = "http://127.0.0.1:1455/auth/callback?code=ok&state=faux";

const FAKE_PROVIDER_NAME = "Faux";

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
    providerName: FAKE_PROVIDER_NAME,
  },
  {
    provider: "faux",
    modelId: "faux-2",
    name: "Faux Two",
    contextWindow: 128000,
    reasoning: false,
    images: true,
    thinkingLevels: ["off"],
    providerName: FAKE_PROVIDER_NAME,
  },
  {
    provider: "faux",
    modelId: "faux-fast",
    name: "Faux Fast",
    contextWindow: 128000,
    reasoning: false,
    images: true,
    thinkingLevels: ["off"],
    providerName: FAKE_PROVIDER_NAME,
  },
  {
    provider: "faux",
    modelId: "faux-text",
    name: "Faux Text",
    contextWindow: 128000,
    reasoning: false,
    images: false,
    thinkingLevels: ["off"],
    providerName: FAKE_PROVIDER_NAME,
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
