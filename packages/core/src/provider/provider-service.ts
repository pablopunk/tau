import { dirname, join } from "node:path";
import type { Models } from "@earendil-works/pi-ai/models";
import {
  AppError,
  type ClaudeConnector,
  type ModelInfo,
  type ModelRef,
  type ProviderId,
  type ProviderInfo,
} from "@tau/protocol";
import type { Approvals } from "../approvals/approvals-port";
import { FileCredentialStore } from "../auth/file-credential-store";
import type { ChangeEmitter } from "../change-emitter";
import type { ObservedResultStore } from "../claude-cli/connectors/observed-results";
import { bundledSdkHomeOf, type ClaudeSdkInstaller, sdkHomeOf } from "../claude-cli/sdk-install";
import { claudeCliDisabled, createClaudeCliService } from "../claude-cli/service";
import { createOpenaiClient } from "../decisions/openai";
import { createTypesafeClient } from "../decisions/typesafe";
import type { SettingsStore } from "../home/settings-store";
import { createFauxSetup } from "../testing/faux-provider";
import { loadFauxReplies } from "../testing/faux-replies";
import { createConnectionReader } from "./connections";
import { createDecisionsStatus, isDecisionBackend } from "./decisions-status";
import { createLoginSessions, type LoginSessions } from "./login-sessions";
import { createModelLister } from "./model-list";
import {
  countsForChat,
  type KeyProviderEntry,
  type ProviderEntry,
  primaryPiId,
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
  /** The release folder with the bundled `claude-sdk`; absent in a dev checkout. */
  readonly versionDir?: string;
  /** Tests inject a fake installer; production installs nothing (the SDK ships in the archive). */
  readonly claudeSdkInstaller?: ClaudeSdkInstaller;
  readonly approvals?: Approvals;
  readonly observed?: ObservedResultStore;
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
  /** Resolves once the Claude CLI check and its model list are in (no connector probe), or after `timeoutMs`. Never rejects. */
  ready(timeoutMs: number): Promise<void>;
  lists(ref: ModelRef): Promise<boolean>;
  acknowledgeClaudeCli(): Promise<ProviderInfo>;
  refreshClaudeCli(): Promise<ProviderInfo>;
  installClaudeCliSdk(): Promise<ProviderInfo>;
  /** Archive and delete: closes the Claude CLI query of a Pi session. */
  closeClaudeCliThread(piSessionId: string): Promise<void>;
  interruptClaudeCliThread(piSessionId: string): Promise<void>;
  /** The last connector probe; `null` before one ran. */
  claudeConnectors(): readonly ClaudeConnector[] | null;
  close(): Promise<void>;
}

function settleWithin(work: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`tau: models were not ready after ${timeoutMs} ms; interrupted runs may fail`);
      resolve();
    }, timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export function createProviderService(options: ProviderServiceOptions): ProviderService {
  const credentials = new FileCredentialStore(options.credentialsFile);
  const claudeCli = createClaudeCliService({
    env: options.env,
    faux: options.faux,
    onChange: () => options.changes.emit({ resource: "providers" }),
    noticeAt: async () => (await options.settings.get()).claudeCliNoticeAt,
    recordNotice: () => options.settings.setClaudeCliNoticeAt(Date.now()),
    sdkHome: options.versionDir
      ? bundledSdkHomeOf(options.versionDir)
      : sdkHomeOf(dirname(options.credentialsFile)),
    installer: options.claudeSdkInstaller,
    connectorSettings: async () => (await options.settings.get()).claudeConnectors,
    ...(options.approvals && { approvals: options.approvals }),
    ...(options.observed && { observed: options.observed }),
  });
  const models = options.faux
    ? createFauxSetup({
        credentials,
        claudeCli: claudeCli.provider,
        replies: loadFauxReplies(options.env.TAU_FAUX_REPLIES),
      }).models
    : createRealModels(credentials, options.env, claudeCli.provider);
  const connections = createConnectionReader({
    credentials,
    models,
    faux: options.faux,
    claudeCli,
    env: options.env,
  });
  const entries = visibleProviders(!claudeCliDisabled(options.env));
  const lister = createModelLister({
    models,
    connections,
    entries,
    faux: options.faux,
    claudeCliModels: () => claudeCli.provider?.getModels() ?? [],
    claudeCliPrice: (value) => claudeCli.priceOf(value),
  });
  const logins = createLoginSessions({
    models,
    changes: options.changes,
    deviceIdFile: join(dirname(options.credentialsFile), "device-id"),
  });

  let firstCheck: Promise<void> | undefined;
  const firstClaudeCliCheck = (): Promise<void> => {
    if (claudeCliDisabled(options.env)) return Promise.resolve();
    firstCheck ??= claudeCli.refresh().then(
      () => undefined,
      () => undefined,
    );
    return firstCheck;
  };

  async function readAfterFirstCheck(entry: ProviderEntry) {
    if (entry.kind === "cli") await firstClaudeCliCheck();
    return connections.read(entry);
  }

  const decisions = createDecisionsStatus({
    check: (id) => {
      // Faux nodes never touch the network; status stays unknown there.
      if (options.faux) return Promise.resolve("unknown" as const);
      if (id === "typesafe") {
        return createTypesafeClient({
          readCredential: () => connections.keyOf(requireKeyProvider("typesafe")),
          env: options.env,
        }).check();
      }
      return createOpenaiClient({
        getAuth: (providerId) => models.getAuth(providerId),
        env: options.env,
      }).check();
    },
    onRefreshed: () => options.changes.emit({ resource: "providers" }),
  });

  const infoOf = async (entry: ProviderEntry): Promise<ProviderInfo> => ({
    id: entry.id,
    name: entry.name,
    methods: [...entry.methods],
    keyUrl: entry.keyUrl,
    connection: await readAfterFirstCheck(entry),
    cli: entry.kind === "cli" ? claudeCli.status() : null,
    ...(decisions.decisionsFor(entry.id) === undefined
      ? {}
      : { decisions: decisions.decisionsFor(entry.id) }),
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
    const keyIds =
      entry.piProviders.length > 0 ? entry.piProviders.map((ref) => ref.piId) : [primaryPiId(entry)];
    await credentials.writeMany(keyIds, { type: "api_key", key });
    if (valid === null) connections.markUnchecked(entry);
    else connections.markChecked(entry);
    if (isDecisionBackend(id)) decisions.invalidate(id);
    options.changes.emit({ resource: "providers" });
    return infoOf(entry);
  }

  async function disconnect(id: ProviderId): Promise<ProviderInfo> {
    const entry = requireKeyProvider(id);
    const keyIds =
      entry.piProviders.length > 0 ? entry.piProviders.map((ref) => ref.piId) : [primaryPiId(entry)];
    await credentials.deleteMany(keyIds);
    connections.markChecked(entry);
    if (isDecisionBackend(id)) decisions.invalidate(id);
    options.changes.emit({ resource: "providers" });
    return infoOf(entry);
  }

  const claudeCliInfo = () => infoOf(requireProvider("claude-cli"));

  async function acknowledgeClaudeCli(): Promise<ProviderInfo> {
    if (claudeCliDisabled(options.env)) throw new AppError("invalid_request", "Claude CLI is turned off.");
    await claudeCli.acknowledge();
    await claudeCli.refresh();
    return claudeCliInfo();
  }

  async function refreshClaudeCli(): Promise<ProviderInfo> {
    if (claudeCliDisabled(options.env)) throw new AppError("invalid_request", "Claude CLI is turned off.");
    await claudeCli.refresh();
    options.changes.emit({ resource: "providers" });
    return claudeCliInfo();
  }

  async function installClaudeCliSdk(): Promise<ProviderInfo> {
    if (claudeCliDisabled(options.env)) throw new AppError("invalid_request", "Claude CLI is turned off.");
    try {
      await claudeCli.installSdk();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AppError("internal", `Could not install the Claude Agent SDK: ${reason}`);
    }
    options.changes.emit({ resource: "providers" });
    return claudeCliInfo();
  }

  return {
    models,
    logins,
    async isConfigured() {
      for (const entry of entries) {
        if (!countsForChat(entry)) continue;
        if (await connections.read(entry)) return true;
      }
      return false;
    },
    list: () => Promise.all(entries.map(infoOf)),
    setApiKey,
    disconnect,
    listModels: async () => {
      await firstClaudeCliCheck();
      return lister.list();
    },
    ready: (timeoutMs) => settleWithin(claudeCli.loadModels(), timeoutMs),
    acknowledgeClaudeCli,
    refreshClaudeCli,
    installClaudeCliSdk,
    closeClaudeCliThread: (piSessionId) => claudeCli.closeThread(piSessionId),
    claudeConnectors: () => claudeCli.status()?.connectors ?? null,
    interruptClaudeCliThread: (piSessionId) => claudeCli.interruptConversation(piSessionId),
    close: () => claudeCli.close(),
    async lists(ref) {
      await firstClaudeCliCheck();
      const available = await lister.list();
      return available.some((model) => model.provider === ref.provider && model.modelId === ref.modelId);
    },
  };
}
