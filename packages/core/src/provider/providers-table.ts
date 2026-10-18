import type { ProviderId, ProviderMethod } from "@tau/protocol";
import {
  type KeyValidator,
  validateAnthropicKey,
  validateGoogleKey,
  validateOpenAiKey,
  validateOpenCodeKey,
  validateOpenRouterKey,
} from "./validators";

export interface PiProviderRef {
  /** Provider id inside pi-ai; credentials and models are keyed by it. */
  readonly piId: string;
  /** Shown as `ModelInfo.providerName`. */
  readonly label: string;
}

export interface ProviderEntry {
  readonly id: ProviderId;
  readonly name: string;
  readonly methods: readonly ProviderMethod[];
  readonly keyUrl: string;
  readonly envVar: string;
  /** A key is written to every one of these (OpenCode: Zen and Go). */
  readonly piProviders: readonly PiProviderRef[];
  readonly validate: KeyValidator;
}

export const PROVIDERS: readonly ProviderEntry[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    methods: ["api_key"],
    keyUrl: "https://openrouter.ai/keys",
    envVar: "OPENROUTER_API_KEY",
    piProviders: [{ piId: "openrouter", label: "OpenRouter" }],
    validate: validateOpenRouterKey,
  },
  {
    id: "openai",
    name: "OpenAI",
    methods: ["api_key", "chatgpt"],
    keyUrl: "https://platform.openai.com/api-keys",
    envVar: "OPENAI_API_KEY",
    piProviders: [{ piId: "openai", label: "OpenAI" }],
    validate: validateOpenAiKey,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    methods: ["api_key"],
    keyUrl: "https://console.anthropic.com/settings/keys",
    envVar: "ANTHROPIC_API_KEY",
    piProviders: [{ piId: "anthropic", label: "Anthropic" }],
    validate: validateAnthropicKey,
  },
  {
    id: "google",
    name: "Google",
    methods: ["api_key"],
    keyUrl: "https://aistudio.google.com/apikey",
    envVar: "GEMINI_API_KEY",
    piProviders: [{ piId: "google", label: "Google" }],
    validate: validateGoogleKey,
  },
  {
    id: "opencode",
    name: "OpenCode",
    methods: ["api_key"],
    keyUrl: "https://opencode.ai/auth",
    envVar: "OPENCODE_API_KEY",
    piProviders: [
      { piId: "opencode", label: "OpenCode Zen" },
      { piId: "opencode-go", label: "OpenCode Go" },
    ],
    validate: validateOpenCodeKey,
  },
];

export function requireProvider(id: ProviderId): ProviderEntry {
  const entry = PROVIDERS.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown provider: ${id}`);
  return entry;
}

export const primaryPiId = (entry: ProviderEntry): string => entry.piProviders[0]?.piId ?? entry.id;
