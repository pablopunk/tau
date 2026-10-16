import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { createModels, getSupportedThinkingLevels, type Models } from "@earendil-works/pi-ai/models";
import { openrouterProvider, personalizeOpenRouterCatalog } from "@earendil-works/pi-ai/providers/openrouter";
import { AppError, type ModelInfo, type ModelRef, type ProviderStatus } from "@pi-everywhere/protocol";
import { FileCredentialStore } from "../auth/file-credential-store";
import { createFauxSetup } from "../testing/faux-provider";
import { assertOpenRouterKeyIsValid, checkOpenRouterKey } from "./openrouter-key";

export const KEY_PROVIDER_ID = "openrouter";
const ENV_KEY_NAME = "OPENROUTER_API_KEY";

export type Environment = Readonly<Record<string, string | undefined>>;

export interface ProviderServiceOptions {
  readonly credentialsFile: string;
  readonly faux: boolean;
  readonly env: Environment;
}

export interface ProviderService {
  /** Passed to the Harness. */
  readonly models: Models;
  isConfigured(): Promise<boolean>;
  status(): Promise<ProviderStatus>;
  setApiKey(key: string): Promise<void>;
  listModels(): Promise<ModelInfo[]>;
  lists(ref: ModelRef): Promise<boolean>;
}

type KeySource = { readonly source: "file" | "env"; readonly key: string };

const fileExists = async (path: string) =>
  access(path.replace(/^~(?=$|\/)/, homedir())).then(
    () => true,
    () => false,
  );

function createRealModels(credentials: FileCredentialStore, env: Environment): Models {
  const models = createModels({ credentials, authContext: { env: async (name) => env[name], fileExists } });
  models.setProvider(openrouterProvider());
  return models;
}

type ListedModel = Parameters<typeof getSupportedThinkingLevels>[0];

function toModelInfo(model: ListedModel): ModelInfo {
  return {
    provider: model.provider,
    modelId: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    reasoning: model.reasoning,
    images: model.input.includes("image"),
    thinkingLevels: getSupportedThinkingLevels(model),
  };
}

export function createProviderService(options: ProviderServiceOptions): ProviderService {
  const credentials = new FileCredentialStore(options.credentialsFile);
  const models = options.faux ? createFauxSetup().models : createRealModels(credentials, options.env);
  const envKeyChecks = new Map<string, Promise<boolean | null>>();

  async function findKey(): Promise<KeySource | undefined> {
    const stored = await credentials.read(KEY_PROVIDER_ID);
    if (stored?.type === "api_key" && stored.key) return { source: "file", key: stored.key };
    const fromEnv = options.env[ENV_KEY_NAME];
    if (!options.faux && fromEnv) return { source: "env", key: fromEnv };
    return undefined;
  }

  function checkEnvKeyOnce(key: string): Promise<boolean | null> {
    let check = envKeyChecks.get(key);
    if (!check) {
      check = checkOpenRouterKey(key).then(
        (result) => result === "valid",
        () => null,
      );
      envKeyChecks.set(key, check);
    }
    return check;
  }

  async function requireKey(): Promise<KeySource> {
    const key = await findKey();
    if (!key) throw new AppError("no_provider", "No API key is configured yet.");
    return key;
  }

  async function listModels(): Promise<ModelInfo[]> {
    const { key } = await requireKey();
    if (options.faux) return models.getModels("faux").map((model) => toModelInfo(model as ListedModel));
    const catalog = models.getModels(KEY_PROVIDER_ID);
    try {
      const allowed = await personalizeOpenRouterCatalog(catalog, {
        credential: { type: "api_key", key },
        publish: async () => false,
        allowNetwork: true,
        signal: new AbortController().signal,
      });
      return allowed.map((model) => toModelInfo(model as ListedModel));
    } catch {
      throw new AppError("internal", "Could not load the model list from OpenRouter.");
    }
  }

  return {
    models,
    isConfigured: async () => (await findKey()) !== undefined,
    async status() {
      const found = await findKey();
      if (!found) return { provider: KEY_PROVIDER_ID, configured: false, source: null, valid: null };
      const valid = found.source === "file" ? true : await checkEnvKeyOnce(found.key);
      return { provider: KEY_PROVIDER_ID, configured: true, source: found.source, valid };
    },
    async setApiKey(rawKey) {
      const key = rawKey.trim();
      if (key === "") throw new AppError("invalid_key", "The API key is empty.");
      if (!options.faux) await assertOpenRouterKeyIsValid(key);
      await credentials.modify(KEY_PROVIDER_ID, async () => ({ type: "api_key", key }));
    },
    listModels,
    async lists(ref) {
      const available = await listModels();
      return available.some((model) => model.provider === ref.provider && model.modelId === ref.modelId);
    },
  };
}
