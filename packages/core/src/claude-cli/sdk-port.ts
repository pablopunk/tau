import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { runAuthStatus } from "./auth-status";
import { TOOL_SEARCH_CLI_NAME } from "./connectors/names";
import { ClaudeSdkMissingError } from "./sdk-missing";
import type {
  ClaudeAccountInfo,
  ClaudeCanUseTool,
  ClaudeContextSummary,
  ClaudeEffort,
  ClaudeMcpServerStatus,
  ClaudeMcpState,
  ClaudeModelOption,
  ClaudeProbe,
  ClaudeProbeOptions,
  ClaudeQuery,
  ClaudeQueryOptions,
  ClaudeSdkMessage,
  ClaudeSdkPort,
} from "./sdk-types";
import { buildToolServer, type CreateSdkMcpServer, TOOL_SERVER_NAME } from "./tool-server";

const SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";
const API_KEY_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

interface SdkMcpStatus {
  name: string;
  status: ClaudeMcpState;
  source?: string;
  scope?: string;
  error?: string;
  tools?: { name: string; annotations?: { readOnly?: boolean } }[];
}

interface SdkContextCategory {
  name: string;
  tokens: number;
  kind?: "used" | "free" | "buffer" | "deferred";
}

interface SdkContextUsage {
  isAutoCompactEnabled: boolean;
  totalTokens?: number;
  categories?: SdkContextCategory[];
  memoryFiles: { tokens: number }[];
  mcpTools: { serverName: string; isLoaded?: boolean }[];
}

const isMcpRow = (category: SdkContextCategory): boolean => category.name.startsWith("MCP tools");

const mcpTokensOf = (usage: SdkContextUsage, kind: "used" | "deferred"): number =>
  (usage.categories ?? [])
    .filter((category) => isMcpRow(category) && category.kind === kind)
    .reduce((sum, category) => sum + category.tokens, 0);

/** `isLoaded` is false for most tools even when they sit in the window, so the deferred row decides. */
const isInWindow = (tool: SdkContextUsage["mcpTools"][number], deferredTokens: number): boolean =>
  deferredTokens === 0 || tool.isLoaded === true;

export const toContextSummary = (usage: SdkContextUsage): ClaudeContextSummary => {
  const deferredMcpTokens = mcpTokensOf(usage, "deferred");
  const loadedMcpToolCounts: Record<string, number> = {};
  for (const tool of usage.mcpTools)
    if (isInWindow(tool, deferredMcpTokens))
      loadedMcpToolCounts[tool.serverName] = (loadedMcpToolCounts[tool.serverName] ?? 0) + 1;
  return {
    memoryFileCount: usage.memoryFiles.length,
    loadedMcpToolCounts,
    totalTokens: usage.totalTokens ?? 0,
    mcpTokens: mcpTokensOf(usage, "used"),
    deferredMcpTokens,
  };
};

interface SdkPermissionOptions {
  signal: AbortSignal;
  toolUseID: string;
  mcpServer?: { name: string; source: string };
}

interface SdkQuery extends AsyncIterable<ClaudeSdkMessage> {
  interrupt(): Promise<unknown>;
  setModel(model?: string): Promise<void>;
  applyFlagSettings(settings: Record<string, unknown>): Promise<void>;
  close(): void;
  mcpServerStatus(): Promise<SdkMcpStatus[]>;
  toggleMcpServer(name: string, enabled: boolean): Promise<void>;
  getContextUsage(): Promise<SdkContextUsage>;
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

const toServerStatus = (server: SdkMcpStatus): ClaudeMcpServerStatus => ({
  name: server.name,
  status: server.status,
  source: server.source ?? server.scope ?? null,
  error: server.error ?? null,
  tools: (server.tools ?? []).map((tool) => ({
    name: tool.name,
    readOnly: tool.annotations?.readOnly === true,
  })),
});

const toSdkCanUseTool =
  (canUseTool: ClaudeCanUseTool) =>
  (toolName: string, input: Record<string, unknown>, options: SdkPermissionOptions) =>
    canUseTool({
      toolName,
      input,
      toolUseId: options.toolUseID,
      signal: options.signal,
      mcpServer: options.mcpServer ?? null,
    });

const mcpToggleOf = (query: SdkQuery) => ({
  toggleMcpServer: (name: string, enabled: boolean) => query.toggleMcpServer(name, enabled),
});

const mcpControlOf = (query: SdkQuery) => ({
  mcpServerStatus: async () => (await query.mcpServerStatus()).map(toServerStatus),
});

function sdkOptions(sdk: SdkModule, options: ClaudeQueryOptions): Record<string, unknown> {
  const toolServer = options.toolHost ? buildToolServer(sdk.createSdkMcpServer, options.toolHost) : undefined;
  const { prompt: _prompt, toolHost: _host, canUseTool, env, mcpServers, ...rest } = options;
  return {
    ...rest,
    ...(canUseTool && { canUseTool: toSdkCanUseTool(canUseTool) }),
    env: withoutApiKeys(env),
    ...((toolServer || mcpServers) && {
      mcpServers: { ...mcpServers, ...(toolServer && { [TOOL_SERVER_NAME]: toolServer.config }) },
    }),
  };
}

function wrapQuery(query: SdkQuery, exposeToggle: boolean): ClaudeQuery {
  return {
    [Symbol.asyncIterator]: () => query[Symbol.asyncIterator](),
    interrupt: async () => void (await query.interrupt()),
    setModel: (model) => query.setModel(model),
    applyFlagSettings: (settings) => query.applyFlagSettings({ ...settings }),
    isAutoCompactEnabled: async () => (await query.getContextUsage()).isAutoCompactEnabled,
    ...mcpControlOf(query),
    ...(exposeToggle && mcpToggleOf(query)),
    close: () => query.close(),
  };
}

const probeOptions = (options: ClaudeProbeOptions): Record<string, unknown> => ({
  cwd: tmpdir(),
  settingSources: options.settingSources ?? [],
  tools: [TOOL_SEARCH_CLI_NAME],
  strictMcpConfig: false,
  settings: { disableClaudeAiConnectors: false },
  permissionMode: "dontAsk",
  env: withoutApiKeys(process.env),
});

function startProbe(sdk: SdkModule, options: ClaudeProbeOptions, exposeToggle: boolean): ClaudeProbe {
  let release: () => void = () => undefined;
  const neverSendsAPrompt = (async function* () {
    await new Promise<void>((resolve) => (release = resolve));
  })();
  const query = sdk.query({ prompt: neverSendsAPrompt, options: probeOptions(options) });
  return {
    ...mcpControlOf(query),
    ...(exposeToggle && mcpToggleOf(query)),
    contextSummary: async () => toContextSummary(await query.getContextUsage()),
    close() {
      release();
      query.close();
    },
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

function portOf(sdk: SdkModule, entry: string, exposeToggle: boolean): ClaudeSdkPort {
  return {
    authStatus: () => runAuthStatus(process.env),
    accountInfo: () => withIdleQuery(sdk, async (query) => toAccountInfo(await query.accountInfo())),
    supportedModels: () =>
      withIdleQuery(sdk, async (query) => (await query.supportedModels()).map(toModelOption)),
    bundledCliVersion: () => readBundledCliVersion(entry),
    startProbe: (options = {}) => startProbe(sdk, options, exposeToggle),
    startQuery(options) {
      return wrapQuery(
        sdk.query({ prompt: options.prompt, options: sdkOptions(sdk, options) }),
        exposeToggle,
      );
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
export async function loadClaudeSdkPort(
  sdkHome?: string,
  options: { readonly exposeToggleForPins?: boolean } = {},
): Promise<ClaudeSdkPort> {
  const { sdk, entry } = await importSdk(sdkHome);
  return portOf(sdk, entry, options.exposeToggleForPins ?? false);
}
