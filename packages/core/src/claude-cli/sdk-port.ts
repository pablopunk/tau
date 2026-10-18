import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { runAuthStatus } from "./auth-status";
import { ClaudeSdkMissingError } from "./sdk-missing";
import type {
  ClaudeAccountInfo,
  ClaudeEffort,
  ClaudeModelOption,
  ClaudeQuery,
  ClaudeQueryOptions,
  ClaudeSdkMessage,
  ClaudeSdkPort,
} from "./sdk-types";
import { buildToolServer, type CreateSdkMcpServer, TOOL_SERVER_NAME } from "./tool-server";

const SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";
const API_KEY_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

interface SdkQuery extends AsyncIterable<ClaudeSdkMessage> {
  interrupt(): Promise<unknown>;
  setModel(model?: string): Promise<void>;
  applyFlagSettings(settings: Record<string, unknown>): Promise<void>;
  close(): void;
  getContextUsage(): Promise<{ isAutoCompactEnabled: boolean }>;
  accountInfo(): Promise<{ organization?: string; subscriptionType?: string }>;
  supportedModels(): Promise<
    {
      value: string;
      resolvedModel?: string;
      displayName: string;
      description: string;
      supportedEffortLevels?: ClaudeEffort[];
      supportsThinkingOff?: boolean;
    }[]
  >;
}

interface SdkModule {
  query(params: { prompt: unknown; options: Record<string, unknown> }): SdkQuery;
  createSdkMcpServer: CreateSdkMcpServer;
  deleteSession(sessionId: string): Promise<void>;
}

const withoutApiKeys = (env: Readonly<Record<string, string | undefined>>) =>
  Object.fromEntries(Object.entries(env).filter(([name]) => !API_KEY_VARIABLES.includes(name)));

function sdkOptions(sdk: SdkModule, options: ClaudeQueryOptions): Record<string, unknown> {
  const toolServer = options.toolHost ? buildToolServer(sdk.createSdkMcpServer, options.toolHost) : undefined;
  const { prompt: _prompt, toolHost: _host, env, ...rest } = options;
  return {
    ...rest,
    env: withoutApiKeys(env),
    ...(toolServer && { mcpServers: { [TOOL_SERVER_NAME]: toolServer.config } }),
  };
}

function wrapQuery(query: SdkQuery): ClaudeQuery {
  return {
    [Symbol.asyncIterator]: () => query[Symbol.asyncIterator](),
    interrupt: async () => void (await query.interrupt()),
    setModel: (model) => query.setModel(model),
    applyFlagSettings: (settings) => query.applyFlagSettings({ ...settings }),
    isAutoCompactEnabled: async () => (await query.getContextUsage()).isAutoCompactEnabled,
    close: () => query.close(),
  };
}

const idleOptions = (): Record<string, unknown> => ({
  cwd: tmpdir(),
  settingSources: [],
  tools: [],
  strictMcpConfig: true,
  settings: { disableClaudeAiConnectors: true },
  env: withoutApiKeys(process.env),
});

async function withIdleQuery<T>(sdk: SdkModule, use: (query: SdkQuery) => Promise<T>): Promise<T> {
  let release: () => void = () => undefined;
  const neverSendsAPrompt = (async function* () {
    await new Promise<void>((resolve) => (release = resolve));
  })();
  const query = sdk.query({ prompt: neverSendsAPrompt, options: idleOptions() });
  try {
    return await use(query);
  } finally {
    release();
    query.close();
  }
}

async function readBundledCliVersion(entry: string): Promise<string> {
  const manifest = JSON.parse(await readFile(join(dirname(entry), "package.json"), "utf8")) as {
    claudeCodeVersion?: string;
  };
  if (!manifest.claudeCodeVersion) throw new Error("The Agent SDK package has no claudeCodeVersion.");
  return manifest.claudeCodeVersion;
}

const toModelOption = (
  model: Awaited<ReturnType<SdkQuery["supportedModels"]>>[number],
): ClaudeModelOption => ({
  value: model.value,
  resolvedModel: model.resolvedModel ?? null,
  displayName: model.displayName,
  description: model.description,
  supportedEffortLevels: model.supportedEffortLevels ?? [],
  supportsThinkingOff: model.supportsThinkingOff ?? false,
});

const toAccountInfo = (info: Awaited<ReturnType<SdkQuery["accountInfo"]>>): ClaudeAccountInfo => ({
  organization: info.organization ?? null,
  subscriptionType: info.subscriptionType ?? null,
});

function portOf(sdk: SdkModule, entry: string): ClaudeSdkPort {
  return {
    authStatus: () => runAuthStatus(process.env),
    accountInfo: () => withIdleQuery(sdk, async (query) => toAccountInfo(await query.accountInfo())),
    supportedModels: () =>
      withIdleQuery(sdk, async (query) => (await query.supportedModels()).map(toModelOption)),
    bundledCliVersion: () => readBundledCliVersion(entry),
    startQuery(options) {
      return wrapQuery(sdk.query({ prompt: options.prompt, options: sdkOptions(sdk, options) }));
    },
    deleteSession: (sessionId) => sdk.deleteSession(sessionId),
  };
}

const resolveInSdkHome = (sdkHome: string): string | null => {
  try {
    return createRequire(join(sdkHome, "package.json")).resolve(SDK_PACKAGE);
  } catch {
    return null;
  }
};

const resolveInDevelopment = (): string | null => {
  try {
    return createRequire(import.meta.url).resolve(SDK_PACKAGE);
  } catch {
    return null;
  }
};

async function importSdk(sdkHome: string | undefined): Promise<{ sdk: SdkModule; entry: string }> {
  const entry = (sdkHome && resolveInSdkHome(sdkHome)) || resolveInDevelopment();
  if (!entry) throw new ClaudeSdkMissingError();
  return { sdk: (await import(pathToFileURL(entry).href)) as SdkModule, entry };
}

/** The only place the Agent SDK is loaded. Nothing imports it while the kill switch is on. */
export async function loadClaudeSdkPort(sdkHome?: string): Promise<ClaudeSdkPort> {
  const { sdk, entry } = await importSdk(sdkHome);
  return portOf(sdk, entry);
}
