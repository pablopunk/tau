import { AppError, type ProviderId, type ProviderMethod } from "@tau/protocol";
import { CLAUDE_CLI_PROVIDER_ID, CLAUDE_CLI_PROVIDER_NAME } from "../claude-cli/provider";
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

export interface KeyProviderEntry {
  readonly kind: "key";
  readonly id: ProviderId;
  readonly name: string;
  readonly methods: readonly ProviderMethod[];
  readonly keyUrl: string;
  readonly envVar: string;
  /** A key is written to every one of these (OpenCode: Zen and Go). */
  readonly piProviders: readonly PiProviderRef[];
  readonly validate: KeyValidator;
}

/** Connected by a local CLI login, not a key: no key URL, no validator, nothing to store or remove. */
export interface CliProviderEntry {
  readonly kind: "cli";
  readonly id: ProviderId;
  readonly name: string;
  readonly methods: readonly ProviderMethod[];
  readonly keyUrl: "";
  readonly piProviders: readonly PiProviderRef[];
}

export type ProviderEntry = KeyProviderEntry | CliProviderEntry;

const KEY_PROVIDERS: readonly Omit<KeyProviderEntry, "kind">[] = [
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

const CLAUDE_CLI_ENTRY: CliProviderEntry = {
  kind: "cli",
  id: "claude-cli",
  name: "Claude CLI",
  methods: ["claude_cli"],
  keyUrl: "",
  piProviders: [{ piId: CLAUDE_CLI_PROVIDER_ID, label: CLAUDE_CLI_PROVIDER_NAME }],
};

export const PROVIDERS: readonly ProviderEntry[] = [
  ...KEY_PROVIDERS.map((entry): KeyProviderEntry => ({ ...entry, kind: "key" })),
  CLAUDE_CLI_ENTRY,
];

/** The providers a user can see. The kill switch removes the CLI entry. */
export const visibleProviders = (claudeCliEnabled: boolean): readonly ProviderEntry[] =>
  claudeCliEnabled ? PROVIDERS : PROVIDERS.filter((entry) => entry.kind !== "cli");

export function requireProvider(id: ProviderId): ProviderEntry {
  const entry = PROVIDERS.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown provider: ${id}`);
  return entry;
}

/** Keys are written and removed only for key providers; a CLI provider has no key to touch. */
export function requireKeyProvider(id: ProviderId): KeyProviderEntry {
  const entry = requireProvider(id);
  if (entry.kind === "cli") {
    throw new AppError("invalid_request", `${entry.name} has no API key. It uses your claude CLI login.`);
  }
  return entry;
}

export const primaryPiId = (entry: ProviderEntry): string => entry.piProviders[0]?.piId ?? entry.id;
