import type { ClaudeConnector, ModelInfo, ProviderInfo, ThinkingLevel } from "@tau/protocol";

export const FAKE_PROVIDERS: readonly Omit<ProviderInfo, "connection" | "cli">[] = [
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
  { id: "claude-cli", name: "Claude CLI", methods: ["claude_cli"], keyUrl: "" },
];

const CLAUDE_CLI_NAME = "Claude CLI";
const CLAUDE_CLI_LEVELS: ThinkingLevel[] = ["off", "low", "medium", "high", "xhigh"];

const claudeModel = (
  modelId: string,
  name: string,
  levels: ThinkingLevel[],
  cost: ModelInfo["cost"],
): ModelInfo => ({
  cost,
  provider: "claude-cli",
  modelId,
  name,
  contextWindow: 1_000_000,
  reasoning: levels.length > 1,
  images: true,
  thinkingLevels: levels,
  providerName: CLAUDE_CLI_NAME,
});

/** Listed once the Claude CLI notice is accepted. */
export const FAKE_CLAUDE_CLI_MODELS: readonly ModelInfo[] = [
  claudeModel("opus", "Opus 5.5 (opus)", CLAUDE_CLI_LEVELS, { input: 15, output: 75 }),
  claudeModel("sonnet", "Sonnet 5.5 (sonnet)", CLAUDE_CLI_LEVELS, { input: 3, output: 15 }),
  claudeModel("haiku", "Haiku 5.5 (haiku)", ["off"], { input: 1, output: 5 }),
];

export const FAKE_CLAUDE_CLI_RESETS_AT = 1_800_000_000_000;

export const FAKE_CLAUDE_CONNECTORS: readonly ClaudeConnector[] = [
  { name: "claude.ai Linear", source: "claudeai", status: "connected", toolCount: 76, readOnlyCount: 41 },
  { name: "claude.ai Slack", source: "claudeai", status: "connected", toolCount: 19, readOnlyCount: 12 },
  { name: "claude.ai Notion", source: "claudeai", status: "needs_auth", toolCount: 0, readOnlyCount: 0 },
];

export const FAKE_AUTH_URL = "https://auth.fake.test/authorize?state=faux";
export const FAKE_VALID_CALLBACK_URL = "http://127.0.0.1:1455/auth/callback?code=ok&state=faux";

const FAKE_PROVIDER_NAME = "Faux";

const REASONING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

export const FAKE_MODELS: readonly ModelInfo[] = [
  {
    provider: "faux",
    modelId: "faux-1",
    cost: { input: 1, output: 5 },
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
    cost: { input: 3, output: 15 },
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
    cost: { input: 0.1, output: 0.5 },
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
