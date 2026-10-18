import {
  type McpServerConfig,
  McpServerConfigSchema,
  type MessageMode,
  MessageModeSchema,
  type ModelRef,
  ModelRefSchema,
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
  lastWorkspaceModes?: Record<string, WorkspaceMode>;
  mcpServers?: McpServerConfig[];
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
  if (raw.lastWorkspaceModes !== undefined)
    stored.lastWorkspaceModes = validLastWorkspaceModes(raw.lastWorkspaceModes);
  if (raw.mcpServers !== undefined) stored.mcpServers = validMcpServers(raw.mcpServers);
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
