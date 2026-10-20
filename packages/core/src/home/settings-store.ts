import {
  type ClaudeConnectorSettings,
  ClaudeConnectorSettingsSchema,
  DEFAULT_RESOURCE_SETTINGS,
  HEAVY_SLOTS_MAX,
  HEAVY_SLOTS_MIN,
  type McpServerConfig,
  McpServerConfigSchema,
  MEMORY_LIMIT_MIN_MB,
  type MessageMode,
  MessageModeSchema,
  type ModelRef,
  ModelRefSchema,
  type RemoteSettings,
  RemoteSettingsSchema,
  ResourcePrioritySchema,
  type ResourceSettings,
  type Settings,
  type ThinkingLevel,
  ThinkingLevelSchema,
  type WorkspaceDefault,
  WorkspaceDefaultSchema,
  type WorkspaceMode,
  WorkspaceModeSchema,
} from "@tau/protocol";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { readFileIfPresent, writeFileAtomic } from "./atomic-write";
import { createSerialQueue } from "./serial-queue";

type StoredSettings = {
  defaultModel?: ModelRef;
  defaultThinkingLevel?: ThinkingLevel;
  fastModel?: ModelRef;
  fastThinkingLevel?: ThinkingLevel;
  projectsFolder?: string;
  messageMode?: MessageMode;
  workspaceDefault?: WorkspaceDefault;
  claudeCliNoticeAt?: number;
  claudeConnectors?: ClaudeConnectorSettings;
  lastWorkspaceModes?: Record<string, WorkspaceMode>;
  mcpServers?: McpServerConfig[];
  remote?: RemoteSettings;
  resources?: ResourceSettings;
  setupSkipped?: boolean;
};

const parseJson = (text: string | undefined): Record<string, unknown> => {
  if (text === undefined) return {};
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const validModelRef = (value: unknown): ModelRef | undefined =>
  Value.Check(ModelRefSchema, value) ? { provider: value.provider, modelId: value.modelId } : undefined;

const validLevel = (value: unknown): ThinkingLevel | undefined =>
  Value.Check(ThinkingLevelSchema, value) ? value : undefined;

const validFolder = (value: unknown): string | undefined =>
  Value.Check(Type.String({ minLength: 1 }), value) ? value : undefined;

const validMessageMode = (value: unknown): MessageMode | undefined =>
  Value.Check(MessageModeSchema, value) ? value : undefined;

const validWorkspaceMode = (value: unknown): WorkspaceMode | undefined =>
  Value.Check(WorkspaceModeSchema, value) ? value : undefined;

const validWorkspaceDefault = (value: unknown): WorkspaceDefault | undefined =>
  Value.Check(WorkspaceDefaultSchema, value) ? value : undefined;

const validLastWorkspaceModes = (value: unknown): Record<string, WorkspaceMode> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const modes: Record<string, WorkspaceMode> = {};
  for (const [projectId, mode] of Object.entries(value)) {
    const valid = validWorkspaceMode(mode);
    if (valid) modes[projectId] = valid;
  }
  return modes;
};

const copyConnectorSettings = (value: ClaudeConnectorSettings): ClaudeConnectorSettings => ({
  disabled: [...value.disabled],
  alwaysAllow: [...value.alwaysAllow],
  askBeforeWrites: value.askBeforeWrites,
});

/** Older files stored an opt-in `enabled` list; it is dropped so every connector starts on. */
const withoutLegacyEnabled = (value: unknown): object => {
  const { enabled: _legacy, ...rest } = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  return { disabled: [], askBeforeWrites: false, ...rest };
};

const validClaudeConnectors = (value: unknown): ClaudeConnectorSettings | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = withoutLegacyEnabled(value);
  return Value.Check(ClaudeConnectorSettingsSchema, candidate)
    ? copyConnectorSettings(candidate as ClaudeConnectorSettings)
    : undefined;
};

const validSlots = (value: unknown): number | null =>
  Number.isInteger(value) && (value as number) >= HEAVY_SLOTS_MIN && (value as number) <= HEAVY_SLOTS_MAX
    ? (value as number)
    : null;

const validMemoryMb = (value: unknown): number | null =>
  Number.isInteger(value) && (value as number) >= MEMORY_LIMIT_MIN_MB ? (value as number) : null;

const validAppliesTo = (value: unknown): ResourceSettings["appliesTo"] => {
  const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const defaults = DEFAULT_RESOURCE_SETTINGS.appliesTo;
  const flag = (key: keyof typeof defaults) => (typeof raw[key] === "boolean" ? raw[key] : defaults[key]);
  return { main: flag("main"), worktrees: flag("worktrees"), subagents: flag("subagents") };
};

/** Each field on its own: a missing or invalid one falls back to its default (Off). */
export function parseResourceSettings(value: unknown): ResourceSettings | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return {
    priority: Value.Check(ResourcePrioritySchema, raw.priority) ? raw.priority : "off",
    heavySlots: validSlots(raw.heavySlots),
    memoryLimitMb: validMemoryMb(raw.memoryLimitMb),
    appliesTo: validAppliesTo(raw.appliesTo),
  };
}

const copyResources = (value: ResourceSettings): ResourceSettings => ({
  ...value,
  appliesTo: { ...value.appliesTo },
});

const validMcpServers = (value: unknown): McpServerConfig[] =>
  Array.isArray(value)
    ? value.filter((item): item is McpServerConfig => Value.Check(McpServerConfigSchema, item))
    : [];

/** Each field is validated on its own, so one bad field never discards the others. */
function parseStored(text: string | undefined): StoredSettings {
  const raw = parseJson(text);
  const stored: StoredSettings = {};
  const defaultModel = validModelRef(raw.defaultModel);
  const fastModel = validModelRef(raw.fastModel);
  const projectsFolder = validFolder(raw.projectsFolder);
  if (defaultModel) stored.defaultModel = defaultModel;
  if (fastModel) stored.fastModel = fastModel;
  const defaultThinkingLevel = validLevel(raw.defaultThinkingLevel);
  const fastThinkingLevel = validLevel(raw.fastThinkingLevel);
  if (defaultThinkingLevel) stored.defaultThinkingLevel = defaultThinkingLevel;
  if (fastThinkingLevel) stored.fastThinkingLevel = fastThinkingLevel;
  if (projectsFolder) stored.projectsFolder = projectsFolder;
  const messageMode = validMessageMode(raw.messageMode);
  const workspaceDefault = validWorkspaceDefault(raw.workspaceDefault);
  if (messageMode) stored.messageMode = messageMode;
  if (workspaceDefault) stored.workspaceDefault = workspaceDefault;
  if (typeof raw.claudeCliNoticeAt === "number") stored.claudeCliNoticeAt = raw.claudeCliNoticeAt;
  const claudeConnectors = validClaudeConnectors(raw.claudeConnectors);
  if (claudeConnectors) stored.claudeConnectors = claudeConnectors;
  if (raw.lastWorkspaceModes !== undefined)
    stored.lastWorkspaceModes = validLastWorkspaceModes(raw.lastWorkspaceModes);
  if (Value.Check(RemoteSettingsSchema, raw.remote)) stored.remote = { enabled: raw.remote.enabled };
  if (raw.mcpServers !== undefined) stored.mcpServers = validMcpServers(raw.mcpServers);
  const resources = parseResourceSettings(raw.resources);
  if (resources) stored.resources = resources;
  if (raw.setupSkipped === true) stored.setupSkipped = true;
  return stored;
}

const withDefaults = (stored: StoredSettings, defaultProjectsFolder: string): Settings => ({
  defaultModel: stored.defaultModel ?? null,
  defaultThinkingLevel: stored.defaultThinkingLevel ?? null,
  fastModel: stored.fastModel ?? null,
  fastThinkingLevel: stored.fastThinkingLevel ?? null,
  projectsFolder: stored.projectsFolder ?? defaultProjectsFolder,
  messageMode: stored.messageMode ?? "steer",
  workspaceDefault: stored.workspaceDefault ?? "per-project",
  claudeCliNoticeAt: stored.claudeCliNoticeAt ?? null,
  claudeConnectors: stored.claudeConnectors ?? { disabled: [], alwaysAllow: [], askBeforeWrites: false },
  remote: stored.remote ?? { enabled: false },
  resources: stored.resources ? copyResources(stored.resources) : copyResources(DEFAULT_RESOURCE_SETTINGS),
  setupSkipped: stored.setupSkipped ?? false,
});

export interface SettingsStore {
  get(): Promise<Settings>;
  /** The level is stored with the model; `null` means the model's default. */
  setDefaultModel(ref: ModelRef, level: ThinkingLevel | null): Promise<void>;
  setDefaultThinkingLevel(level: ThinkingLevel | null): Promise<void>;
  /** `null` clears it, and its level with it. */
  setFastModel(ref: ModelRef | null, level: ThinkingLevel | null): Promise<void>;
  setFastThinkingLevel(level: ThinkingLevel | null): Promise<void>;
  /** The caller has already validated and resolved the path. */
  setProjectsFolder(path: string): Promise<void>;
  setMessageMode(mode: MessageMode): Promise<void>;
  setWorkspaceDefault(mode: WorkspaceDefault): Promise<void>;
  setClaudeCliNoticeAt(at: number): Promise<void>;
  setSetupSkipped(skipped: boolean): Promise<void>;
  setClaudeConnectors(value: ClaudeConnectorSettings): Promise<void>;
  /** The caller has already validated the value. */
  setResources(value: ResourceSettings): Promise<void>;
  setRemoteEnabled(enabled: boolean): Promise<void>;
  lastWorkspaceMode(projectId: string): Promise<WorkspaceMode | undefined>;
  setLastWorkspaceMode(projectId: string, mode: WorkspaceMode): Promise<void>;
  /** Servers added in Settings. The real values (env, headers) stay here and never reach `Settings`. */
  mcpServers(): Promise<McpServerConfig[]>;
  /** Replaces the server with the same name, or appends. */
  saveMcpServer(config: McpServerConfig): Promise<void>;
  removeMcpServer(name: string): Promise<void>;
}

const copyRef = (ref: ModelRef): ModelRef => ({ provider: ref.provider, modelId: ref.modelId });

export function createSettingsStore(settingsFile: string, defaultProjectsFolder: string): SettingsStore {
  const enqueue = createSerialQueue();
  const readStored = async () => parseStored(await readFileIfPresent(settingsFile));
  const update = (change: (stored: StoredSettings) => StoredSettings) =>
    enqueue(async () => {
      const next = change(await readStored());
      await writeFileAtomic(settingsFile, `${JSON.stringify(next, null, 2)}\n`);
    });
  return {
    get: () => enqueue(async () => withDefaults(await readStored(), defaultProjectsFolder)),
    setDefaultModel: (ref, level) =>
      update(({ defaultThinkingLevel: _level, ...rest }) => ({
        ...rest,
        defaultModel: copyRef(ref),
        ...(level && { defaultThinkingLevel: level }),
      })),
    setDefaultThinkingLevel: (level) =>
      update(({ defaultThinkingLevel: _level, ...rest }) =>
        level ? { ...rest, defaultThinkingLevel: level } : rest,
      ),
    setFastModel: (ref, level) =>
      update(({ fastModel: _model, fastThinkingLevel: _level, ...rest }) =>
        ref === null
          ? rest
          : { ...rest, fastModel: copyRef(ref), ...(level && { fastThinkingLevel: level }) },
      ),
    setFastThinkingLevel: (level) =>
      update(({ fastThinkingLevel: _level, ...rest }) =>
        level ? { ...rest, fastThinkingLevel: level } : rest,
      ),
    setProjectsFolder: (path) => update((stored) => ({ ...stored, projectsFolder: path })),
    setMessageMode: (mode) => update((stored) => ({ ...stored, messageMode: mode })),
    setWorkspaceDefault: (mode) => update((stored) => ({ ...stored, workspaceDefault: mode })),
    setClaudeCliNoticeAt: (at) => update((stored) => ({ ...stored, claudeCliNoticeAt: at })),
    setSetupSkipped: (skipped) =>
      update(({ setupSkipped: _skipped, ...rest }) => (skipped ? { ...rest, setupSkipped: true } : rest)),
    setClaudeConnectors: (value) =>
      update((stored) => ({
        ...stored,
        claudeConnectors: copyConnectorSettings(value),
      })),
    setResources: (value) => update((stored) => ({ ...stored, resources: copyResources(value) })),
    setRemoteEnabled: (enabled) => update((stored) => ({ ...stored, remote: { enabled } })),
    lastWorkspaceMode: async (projectId) => (await readStored()).lastWorkspaceModes?.[projectId],
    setLastWorkspaceMode: (projectId, mode) =>
      update((stored) => ({
        ...stored,
        lastWorkspaceModes: { ...stored.lastWorkspaceModes, [projectId]: mode },
      })),
    mcpServers: () => enqueue(async () => (await readStored()).mcpServers ?? []),
    saveMcpServer: (config) =>
      update((stored) => ({
        ...stored,
        mcpServers: [...(stored.mcpServers ?? []).filter((item) => item.name !== config.name), config],
      })),
    removeMcpServer: (name) =>
      update((stored) => ({
        ...stored,
        mcpServers: (stored.mcpServers ?? []).filter((item) => item.name !== name),
      })),
  };
}
