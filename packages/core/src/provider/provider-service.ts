import { dirname, join } from "node:path";
import type { Models } from "@earendil-works/pi-ai/models";
import { AppError, type ModelInfo, type ModelRef, type ProviderId, type ProviderInfo } from "@tau/protocol";
import { FileCredentialStore } from "../auth/file-credential-store";
import type { ChangeEmitter } from "../change-emitter";
import { claudeCliDisabled, createClaudeCliService } from "../claude-cli/service";
import type { SettingsStore } from "../home/settings-store";
import { createFauxSetup } from "../testing/faux-provider";
import { createConnectionReader } from "./connections";
import { createLoginSessions, type LoginSessions } from "./login-sessions";
import { createModelLister } from "./model-list";
import {
  type KeyProviderEntry,
  type ProviderEntry,
  requireKeyProvider,
  requireProvider,
  visibleProviders,
} from "./providers-table";
import { createRealModels, type Environment } from "./real-models";

export type { Environment } from "./real-models";

export interface ProviderServiceOptions {
  readonly credentialsFile: string;
  readonly faux: boolean;
  readonly env: Environment;
  readonly changes: ChangeEmitter;
  readonly settings: SettingsStore;
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
  acknowledgeClaudeCli(): Promise<ProviderInfo>;
  refreshClaudeCli(): Promise<ProviderInfo>;
  close(): Promise<void>;
}

export function createProviderService(options: ProviderServiceOptions): ProviderService {
  const credentials = new FileCredentialStore(options.credentialsFile);
  const claudeCli = createClaudeCliService({
    env: options.env,
    faux: options.faux,
    onChange: () => options.changes.emit({ resource: "providers" }),
    noticeAt: async () => (await options.settings.get()).claudeCliNoticeAt,
    recordNotice: () => options.settings.setClaudeCliNoticeAt(Date.now()),
  });
  const models = options.faux
    ? createFauxSetup({ credentials }).models
    : createRealModels(credentials, options.env, claudeCli.provider);
  const connections = createConnectionReader({ credentials, models, faux: options.faux, claudeCli });
  const entries = visibleProviders(!claudeCliDisabled(options.env));
  const lister = createModelLister({ models, connections, entries, faux: options.faux });
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
    cli: entry.kind === "cli" ? claudeCli.status() : null,
  });

  async function validated(entry: KeyProviderEntry, key: string): Promise<boolean | null> {
    if (options.faux) return true;
    const check = await entry.validate(key);
    if (check === "invalid") throw new AppError("invalid_key", `${entry.name} rejected this API key.`);
    return check === "valid" ? true : null;
  }

  async function setApiKey(id: ProviderId, rawKey: string): Promise<ProviderInfo> {
    const entry = requireKeyProvider(id);
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
    const entry = requireKeyProvider(id);
    await credentials.deleteMany(entry.piProviders.map((ref) => ref.piId));
    connections.markChecked(entry);
    options.changes.emit({ resource: "providers" });
    return infoOf(entry);
  }

  const claudeCliInfo = () => infoOf(requireProvider("claude-cli"));

  async function acknowledgeClaudeCli(): Promise<ProviderInfo> {
    if (claudeCliDisabled(options.env)) throw new AppError("invalid_request", "Claude CLI is turned off.");
    await claudeCli.acknowledge();
    return claudeCliInfo();
  }

  async function refreshClaudeCli(): Promise<ProviderInfo> {
    if (claudeCliDisabled(options.env)) throw new AppError("invalid_request", "Claude CLI is turned off.");
    await claudeCli.refresh();
    options.changes.emit({ resource: "providers" });
    return claudeCliInfo();
  }

  return {
    models,
    logins,
    async isConfigured() {
      for (const entry of entries) if (await connections.read(entry)) return true;
      return false;
    },
    list: () => Promise.all(entries.map(infoOf)),
    setApiKey,
    disconnect,
    listModels: () => lister.list(),
    acknowledgeClaudeCli,
    refreshClaudeCli,
    close: () => claudeCli.close(),
    async lists(ref) {
      const available = await lister.list();
      return available.some((model) => model.provider === ref.provider && model.modelId === ref.modelId);
    },
  };
}
