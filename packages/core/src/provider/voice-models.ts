import type { VoiceOptions } from "@tau/protocol";
import type { ProviderService } from "./provider-service";

export type VoiceProviderOption = VoiceOptions["providers"][number];

export interface VoiceCatalogModel {
  modelId: string;
  name: string;
}

/** The catalog fetch never throws: failures come back as `{ error }` for the row's `error` field. */
export type VoiceCatalogResult = { models: VoiceCatalogModel[] } | { error: string };

export const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
const MODELS_URL = `${OPENROUTER_API_BASE}/models?input_modalities=audio&output_modalities=transcription`;
const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  at: number;
  result: VoiceCatalogResult;
}

/**
 * Success-only cache keyed by API key: a rotated key misses by construction,
 * so it can never serve another key's catalog. Only successes are cached —
 * a failed fetch retries on the next call.
 */
const catalogCache = new Map<string, CacheEntry>();

/**
 * Drops cached catalogs (all, or one key). The integrator wires this into
 * `setApiKey`/`disconnect` in provider-service.ts as hygiene; correctness
 * does not depend on it because the cache is keyed by API key.
 */
export function clearVoiceModelCache(apiKey?: string): void {
  if (apiKey === undefined) catalogCache.clear();
  else catalogCache.delete(apiKey);
}

/**
 * Live speech-to-text catalog for one OpenRouter key: models whose input takes
 * audio and whose output is transcription.
 */
export async function fetchOpenRouterVoiceModels(apiKey: string): Promise<VoiceCatalogResult> {
  const cached = catalogCache.get(apiKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;
  const result = await loadCatalog(apiKey);
  if (!("error" in result)) catalogCache.set(apiKey, { at: Date.now(), result });
  return result;
}

interface CatalogRow {
  id?: unknown;
  name?: unknown;
  architecture?: { input_modalities?: unknown; output_modalities?: unknown } | null;
}

const hasModality = (value: unknown, modality: string): boolean =>
  Array.isArray(value) && value.includes(modality);

async function loadCatalog(apiKey: string): Promise<VoiceCatalogResult> {
  let response: Response;
  try {
    response = await fetch(MODELS_URL, {
      headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { error: "Could not reach OpenRouter to list speech models. Check your connection." };
  }
  if (!response.ok) {
    return { error: `OpenRouter returned HTTP ${response.status} for the speech model list.` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { error: "OpenRouter returned an unreadable speech model list." };
  }
  const rows = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) {
    return { error: "OpenRouter returned an unexpected speech model list." };
  }
  const models: VoiceCatalogModel[] = [];
  for (const row of rows as CatalogRow[]) {
    if (typeof row?.id !== "string") continue;
    const architecture = row.architecture;
    if (!hasModality(architecture?.input_modalities, "audio")) continue;
    if (!hasModality(architecture?.output_modalities, "transcription")) continue;
    models.push({
      modelId: row.id,
      name: typeof row.name === "string" && row.name !== "" ? row.name : row.id,
    });
  }
  return { models };
}

/** The slice of ProviderService both `options()` and voice-setting validation need. */
export type VoiceProviderSource = Pick<ProviderService, "list" | "models">;

/**
 * One row for the connected OpenRouter key, empty when no OpenRouter key is
 * connected. Fetch failures surface as the row's `error` (never throw), so
 * `voice.options()` stays total. Phase 2 appends hardcoded OpenAI ids when an
 * OpenAI key is connected.
 */
export async function listProviderOptions(source: VoiceProviderSource): Promise<VoiceProviderOption[]> {
  const openrouter = (await source.list()).find((info) => info.id === "openrouter");
  if (!openrouter || openrouter.connection === null) return [];
  const apiKey = (await source.models.getAuth("openrouter"))?.auth.apiKey;
  if (!apiKey) return [];
  const catalog = await fetchOpenRouterVoiceModels(apiKey);
  if ("error" in catalog) {
    return [{ provider: openrouter.id, providerName: openrouter.name, models: [], error: catalog.error }];
  }
  return [{ provider: openrouter.id, providerName: openrouter.name, models: catalog.models }];
}
