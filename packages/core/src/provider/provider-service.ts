import { dirname, join } from "node:path";
import type { Models } from "@earendil-works/pi-ai/models";
import { AppError, type ModelInfo, type ModelRef, type ProviderId, type ProviderInfo } from "@tau/protocol";
import { FileCredentialStore } from "../auth/file-credential-store";
import type { ChangeEmitter } from "../change-emitter";
import { createFauxSetup } from "../testing/faux-provider";
import { createConnectionReader } from "./connections";
import { createLoginSessions, type LoginSessions } from "./login-sessions";
import { createModelLister } from "./model-list";
import { PROVIDERS, type ProviderEntry, requireProvider } from "./providers-table";
import { createRealModels, type Environment } from "./real-models";

export type { Environment } from "./real-models";

export interface ProviderServiceOptions {
  readonly credentialsFile: string;
  readonly faux: boolean;
  readonly env: Environment;
  readonly changes: ChangeEmitter;
}

export interface ProviderService {
  /** Passed to the Harness. */
  readonly models: Models;
  readonly logins: LoginSessions;
  isConfigured(): Promise<boolean>;
  list(): Promise<ProviderInfo[]>;
  setApiKey(id: ProviderId, key: string): Promise<ProviderInfo>;
  disconnect(id: ProviderId): Promise<ProviderInfo>;
  listModels(): Promise<ModelInfo[]>;
  lists(ref: ModelRef): Promise<boolean>;
}

export function createProviderService(options: ProviderServiceOptions): ProviderService {
  const credentials = new FileCredentialStore(options.credentialsFile);
  const models = options.faux
    ? createFauxSetup({ credentials }).models
    : createRealModels(credentials, options.env);
  const connections = createConnectionReader({ credentials, models, faux: options.faux });
  const lister = createModelLister({ models, connections, faux: options.faux });
  const logins = createLoginSessions({
    models,
    changes: options.changes,
    deviceIdFile: join(dirname(options.credentialsFile), "device-id"),
  });

  const infoOf = async (entry: ProviderEntry): Promise<ProviderInfo> => ({
    id: entry.id,
    name: entry.name,
    methods: [...entry.methods],
    keyUrl: entry.keyUrl,
    connection: await connections.read(entry),
  });

  async function validated(entry: ProviderEntry, key: string): Promise<boolean | null> {
    if (options.faux) return true;
    const check = await entry.validate(key);
    if (check === "invalid") throw new AppError("invalid_key", `${entry.name} rejected this API key.`);
    return check === "valid" ? true : null;
  }

  async function setApiKey(id: ProviderId, rawKey: string): Promise<ProviderInfo> {
    const entry = requireProvider(id);
    const key = rawKey.trim();
    if (key === "") throw new AppError("invalid_key", "The API key is empty.");
    const valid = await validated(entry, key);
    await credentials.writeMany(
      entry.piProviders.map((ref) => ref.piId),
      { type: "api_key", key },
    );
    if (valid === null) connections.markUnchecked(entry);
    else connections.markChecked(entry);
    options.changes.emit({ resource: "providers" });
    return infoOf(entry);
  }

  async function disconnect(id: ProviderId): Promise<ProviderInfo> {
    const entry = requireProvider(id);
    await credentials.deleteMany(entry.piProviders.map((ref) => ref.piId));
    connections.markChecked(entry);
    options.changes.emit({ resource: "providers" });
    return infoOf(entry);
  }

  return {
    models,
    logins,
    async isConfigured() {
      for (const entry of PROVIDERS) if (await connections.read(entry)) return true;
      return false;
    },
    list: () => Promise.all(PROVIDERS.map(infoOf)),
    setApiKey,
    disconnect,
    listModels: () => lister.list(),
    async lists(ref) {
      const available = await lister.list();
      return available.some((model) => model.provider === ref.provider && model.modelId === ref.modelId);
    },
  };
}
