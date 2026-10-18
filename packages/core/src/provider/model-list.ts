import { getSupportedThinkingLevels, type Models } from "@earendil-works/pi-ai/models";
import { personalizeOpenRouterCatalog } from "@earendil-works/pi-ai/providers/openrouter";
import { AppError, type ModelInfo } from "@tau/protocol";
import { FAUX_PROVIDER_ID } from "../testing/faux-provider";
import type { ConnectionReader } from "./connections";
import { type PiProviderRef, PROVIDERS, type ProviderEntry } from "./providers-table";

const FAUX_PROVIDER_NAME = "Faux";

type ListedModel = Parameters<typeof getSupportedThinkingLevels>[0];

function toModelInfo(model: ListedModel, providerName: string): ModelInfo {
  return {
    provider: model.provider,
    modelId: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    reasoning: model.reasoning,
    images: model.input.includes("image"),
    thinkingLevels: getSupportedThinkingLevels(model),
    providerName,
  };
}

export interface ModelLister {
  list(): Promise<ModelInfo[]>;
}

export function createModelLister(deps: {
  models: Models;
  connections: ConnectionReader;
  faux: boolean;
}): ModelLister {
  const { models, connections } = deps;

  async function connectedEntries(): Promise<ProviderEntry[]> {
    const connected: ProviderEntry[] = [];
    for (const entry of PROVIDERS) if (await connections.read(entry)) connected.push(entry);
    return connected;
  }

  async function personalizedOpenRouter(piId: string): Promise<readonly ListedModel[]> {
    const catalog = await models.getAvailable(piId);
    const key = (await models.getAuth(piId))?.auth.apiKey;
    try {
      return (await personalizeOpenRouterCatalog(catalog, {
        credential: { type: "api_key", key },
        publish: async () => false,
        allowNetwork: true,
        signal: new AbortController().signal,
      })) as readonly ListedModel[];
    } catch {
      throw new AppError("internal", "Could not load the model list from OpenRouter.");
    }
  }

  async function modelsOf(entry: ProviderEntry, ref: PiProviderRef): Promise<ModelInfo[]> {
    const available =
      entry.id === "openrouter"
        ? await personalizedOpenRouter(ref.piId)
        : await models.getAvailable(ref.piId);
    return available.map((model) => toModelInfo(model as ListedModel, ref.label));
  }

  async function listReal(): Promise<ModelInfo[]> {
    const listed: ModelInfo[] = [];
    for (const entry of await connectedEntries()) {
      for (const ref of entry.piProviders) listed.push(...(await modelsOf(entry, ref)));
    }
    return listed;
  }

  async function listFaux(): Promise<ModelInfo[]> {
    if ((await connectedEntries()).length === 0) return [];
    return models
      .getModels(FAUX_PROVIDER_ID)
      .map((model) => toModelInfo(model as ListedModel, FAUX_PROVIDER_NAME));
  }

  return { list: () => (deps.faux ? listFaux() : listReal()) };
}
