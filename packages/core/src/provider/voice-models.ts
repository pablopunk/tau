import type { VoiceOptions } from "@tau/protocol";

export type VoiceProviderOption = VoiceOptions["providers"][number];

/**
 * Live speech-to-text catalog for one OpenRouter key: models whose input takes
 * audio and whose output is transcription. Agent (b) fills this: port nvm's
 * `transcription-models.ts` (GET `{openrouterBase}/models`, modality filter,
 * 15-min in-memory cache per Core instance, dropped on `setApiKey`).
 */
export async function fetchOpenRouterVoiceModels(
  _apiKey: string,
): Promise<{ modelId: string; name: string }[]> {
  // TODO(agent b): live `GET {openrouterBase}/models` + input∩audio / output∩transcription filter.
  return [];
}

/**
 * One row per connected key that yields a speech model. Agent (b) fills this:
 * OpenRouter rows from `fetchOpenRouterVoiceModels`; fetch failures surface as
 * the row's `error` (never throw). Phase 2 appends the three hardcoded OpenAI
 * ids when an OpenAI key is connected.
 */
export async function listProviderOptions(_connections: {
  list(): Promise<{ id: string; providerName?: string }[]>;
}): Promise<VoiceProviderOption[]> {
  // TODO(agent b): OpenRouter rows for every connected key; per-provider `error` on failure.
  return [];
}
