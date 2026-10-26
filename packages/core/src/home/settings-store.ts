import {
  type ClaudeConnectorSettings,
  ClaudeConnectorSettingsSchema,
  type CompactionSettings,
  CompactionSettingsSchema,
  DEFAULT_RESOURCE_SETTINGS,
  DEFAULT_SANDBOX_SETTINGS,
  type McpServerConfig,
  McpServerConfigSchema,
  type MessageMode,
  MessageModeSchema,
  type ModelRef,
  ModelRefSchema,
  type RemoteSettings,
  RemoteSettingsSchema,
  ResourcePrioritySchema,
  type ResourceSettings,
  type SandboxSettings,
  SandboxSettingsSchema,
  type Settings,
  type ThinkingLevel,
  ThinkingLevelSchema,
  type VoiceModelSetting,
  VoiceModelSettingSchema,
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
  voiceModel?: VoiceModelSetting;
  projectsFolder?: string;
  messageMode?: MessageMode;
  workspaceDefault?: WorkspaceDefault;
  claudeCliNoticeAt?: number;
  claudeConnectors?: ClaudeConnectorSettings;
  lastWorkspaceModes?: Record<string, WorkspaceMode>;
  mcpServers?: McpServerConfig[];
  remote?: RemoteSettings;
  resources?: ResourceSettings;
  sandbox?: SandboxSettings;
  compaction?: CompactionSettings;
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

const validVoiceModel = (value: unknown): VoiceModelSetting | undefined =>
  Value.Check(VoiceModelSettingSchema, value)
    ? value === null
      ? null
      : value.kind === "local"
        ? { kind: "local" }
        : { kind: "provider", provider: value.provider, modelId: value.modelId }
    : undefined;

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

const validPower = (value: unknown): ResourceSettings["levels"]["main"] =>
  Value.Check(ResourcePrioritySchema, value) ? value : "off";

const validLevels = (value: unknown): ResourceSettings["levels"] => {
  const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    main: validPower(raw.main),
    worktree: validPower(raw.worktree),
    subagent: validPower(raw.subagent),
  };
};

/** Legacy `{priority, appliesTo}` maps each ticked scope to the old global priority. */
const migratedLevels = (raw: Record<string, unknown>): ResourceSettings["levels"] => {
  const priority = validPower(raw.priority);
  const boxes =
    typeof raw.appliesTo === "object" && raw.appliesTo !== null
      ? (raw.appliesTo as Record<string, unknown>)
      : {};
  // Old defaults: only subagents ticked.
  const ticked = (key: string, fallback: boolean) =>
    typeof boxes[key] === "boolean" ? (boxes[key] as boolean) : fallback;
  const at = (t: boolean) => (t ? priority : "off") as ResourceSettings["levels"]["main"];
  return {
    main: at(ticked("main", false)),
    worktree: at(ticked("worktrees", false)),
    subagent: at(ticked("subagents", true)),
  };
};

/** Each field on its own: a missing or invalid one falls back to its default (Off). */
export function parseResourceSettings(value: unknown): ResourceSettings | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const levels =
    typeof raw.levels === "object" && raw.levels !== null
      ? validLevels(raw.levels)
      : "priority" in raw || "appliesTo" in raw
        ? migratedLevels(raw)
        : { ...DEFAULT_RESOURCE_SETTINGS.levels };
  return { levels };
}

const copyResources = (value: ResourceSettings): ResourceSettings => ({
  ...value,
  levels: { ...value.levels },
});

const validSandboxFlag = (value: unknown): boolean =>
  Value.Check(SandboxSettingsSchema.properties.main, value) ? (value as boolean) : false;

/** Each field on its own: a missing or invalid one falls back to false (staging gate: all off). */
export function parseSandboxSettings(value: unknown): SandboxSettings | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const allowlist = raw.mcpAllowlist;
  return {
    main: validSandboxFlag(raw.main),
    worktree: validSandboxFlag(raw.worktree),
    subagent: validSandboxFlag(raw.subagent),
    // Absent unless a valid list is stored: older nodes never wrote it.
    ...(Array.isArray(allowlist) && allowlist.every((entry): entry is string => typeof entry === "string")
      ? { mcpAllowlist: [...allowlist] }
      : {}),
  };
}

const copySandbox = (value: SandboxSettings): SandboxSettings => ({
  ...value,
  ...(value.mcpAllowlist === undefined ? {} : { mcpAllowlist: [...value.mcpAllowlist] }),
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
  const voiceModel = validVoiceModel(raw.voiceModel);
  if (voiceModel !== undefined) stored.voiceModel = voiceModel;
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
  if (Value.Check(CompactionSettingsSchema, raw.compaction))
    stored.compaction = { mode: raw.compaction.mode, backend: raw.compaction.backend };
  if (raw.mcpServers !== undefined) stored.mcpServers = validMcpServers(raw.mcpServers);
  const resources = parseResourceSettings(raw.resources);
  if (resources) stored.resources = resources;
  const sandbox = parseSandboxSettings(raw.sandbox);
  if (sandbox) stored.sandbox = sandbox;
  if (raw.setupSkipped === true) stored.setupSkipped = true;
  return stored;
}

const withDefaults = (stored: StoredSettings, defaultProjectsFolder: string): Settings => ({
  defaultModel: stored.defaultModel ?? null,
  defaultThinkingLevel: stored.defaultThinkingLevel ?? null,
  fastModel: stored.fastModel ?? null,
  fastThinkingLevel: stored.fastThinkingLevel ?? null,
  voiceModel: stored.voiceModel ?? null,
  projectsFolder: stored.projectsFolder ?? defaultProjectsFolder,
  messageMode: stored.messageMode ?? "steer",
  workspaceDefault: stored.workspaceDefault ?? "per-project",
  claudeCliNoticeAt: stored.claudeCliNoticeAt ?? null,
  claudeConnectors: stored.claudeConnectors ?? { disabled: [], alwaysAllow: [], askBeforeWrites: false },
  remote: stored.remote ?? { enabled: false },
  resources: stored.resources ? copyResources(stored.resources) : copyResources(DEFAULT_RESOURCE_SETTINGS),
  sandbox: stored.sandbox ? copySandbox(stored.sandbox) : copySandbox(DEFAULT_SANDBOX_SETTINGS),
  compaction: stored.compaction ?? { mode: "summary", backend: "auto" },
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
  /** `null` unsets the default (it never deletes downloaded bytes; that is `voice.removeModel`). */
  setVoiceModel(setting: VoiceModelSetting): Promise<void>;
  /** The caller has already validated and resolved the path. */
  setProjectsFolder(path: string): Promise<void>;
  setMessageMode(mode: MessageMode): Promise<void>;
  setWorkspaceDefault(mode: WorkspaceDefault): Promise<void>;
  setClaudeCliNoticeAt(at: number): Promise<void>;
  setSetupSkipped(skipped: boolean): Promise<void>;
  setClaudeConnectors(value: ClaudeConnectorSettings): Promise<void>;
  /** The caller has already validated the value. */
  setResources(value: ResourceSettings): Promise<void>;
  /** The caller has already validated the value. Phase 1: persisted only, never enforced. */
  setSandbox(value: SandboxSettings): Promise<void>;
  /** The caller has already validated the value. */
  setCompaction(value: CompactionSettings): Promise<void>;
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
    setVoiceModel: (setting) =>
      update(({ voiceModel: _voice, ...rest }) =>
        setting === null
          ? rest
          : {
              ...rest,
              voiceModel:
                setting.kind === "local"
                  ? { kind: "local" }
                  : { kind: "provider", provider: setting.provider, modelId: setting.modelId },
            },
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
    setSandbox: (value) => update((stored) => ({ ...stored, sandbox: copySandbox(value) })),
    setCompaction: (value) =>
      update((stored) => ({ ...stored, compaction: { mode: value.mode, backend: value.backend } })),
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
