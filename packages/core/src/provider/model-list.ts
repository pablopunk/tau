import { getSupportedThinkingLevels, type Models } from "@earendil-works/pi-ai/models";
import { personalizeOpenRouterCatalog } from "@earendil-works/pi-ai/providers/openrouter";
import { AppError, type ModelInfo } from "@tau/protocol";
import { CLAUDE_CLI_PROVIDER_ID, CLAUDE_CLI_PROVIDER_NAME } from "../claude-cli/provider";
import { FAUX_PROVIDER_ID } from "../testing/faux-provider";
import type { ConnectionReader } from "./connections";
import { type CatalogCost, priceOf } from "./model-price";
import type { PiProviderRef, ProviderEntry } from "./providers-table";

const FAUX_REF = { label: "Faux", billing: "usage" } as const;
const CLAUDE_CLI_REF = { label: CLAUDE_CLI_PROVIDER_NAME, billing: "subscription" } as const;

type ListedModel = Parameters<typeof getSupportedThinkingLevels>[0];

export function toModelInfo(
  model: ListedModel,
  ref: Pick<PiProviderRef, "label" | "billing">,
  priceOverride?: CatalogCost,
): ModelInfo {
  const cost = priceOf(model.id, priceOverride ?? model.cost);
  return {
    provider: model.provider,
    modelId: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    reasoning: model.reasoning,
    images: model.input.includes("image"),
    thinkingLevels: getSupportedThinkingLevels(model),
    providerName: ref.label,
    billing: ref.billing,
    ...(cost && { cost }),
  };
}

export interface ModelLister {
  list(): Promise<ModelInfo[]>;
}

export function createModelLister(deps: {
  models: Models;
  connections: ConnectionReader;
  entries: readonly ProviderEntry[];
  faux: boolean;
  /** The Claude CLI provider's own list; faux mode has no registered provider to ask. */
  claudeCliModels: () => readonly ListedModel[];
  /** List price behind a Claude CLI model value; the rows themselves carry cost 0. */
  claudeCliPrice: (modelValue: string) => CatalogCost | undefined;
}): ModelLister {
  const { models, connections } = deps;

  async function connectedEntries(): Promise<ProviderEntry[]> {
    const connected: ProviderEntry[] = [];
    for (const entry of deps.entries) if (await connections.read(entry)) connected.push(entry);
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
    const override = ref.piId === CLAUDE_CLI_PROVIDER_ID ? deps.claudeCliPrice : () => undefined;
    return available.map((model) => toModelInfo(model as ListedModel, ref, override(model.id)));
  }

  async function listReal(): Promise<ModelInfo[]> {
    const listed: ModelInfo[] = [];
    for (const entry of await connectedEntries()) {
      for (const ref of entry.piProviders) listed.push(...(await modelsOf(entry, ref)));
    }
    return listed;
  }

  async function listFaux(): Promise<ModelInfo[]> {
    const connected = await connectedEntries();
    const keyed = connected.some((entry) => entry.kind !== "cli");
    const fauxModels = keyed
      ? models.getModels(FAUX_PROVIDER_ID).map((model) => toModelInfo(model as ListedModel, FAUX_REF))
      : [];
    const cliModels = connected.some((entry) => entry.kind === "cli")
      ? deps
          .claudeCliModels()
          .map((model) => toModelInfo(model, CLAUDE_CLI_REF, deps.claudeCliPrice(model.id)))
      : [];
    return [...fauxModels, ...cliModels];
  }

  return { list: () => (deps.faux ? listFaux() : listReal()) };
}
