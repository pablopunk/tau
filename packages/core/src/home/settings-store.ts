import {
  type ModelRef,
  ModelRefSchema,
  type Settings,
  type ThinkingLevel,
  ThinkingLevelSchema,
} from "@pi-everywhere/protocol";
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
  return stored;
}

const withDefaults = (stored: StoredSettings, defaultProjectsFolder: string): Settings => ({
  defaultModel: stored.defaultModel ?? null,
  defaultThinkingLevel: stored.defaultThinkingLevel ?? null,
  fastModel: stored.fastModel ?? null,
  fastThinkingLevel: stored.fastThinkingLevel ?? null,
  projectsFolder: stored.projectsFolder ?? defaultProjectsFolder,
  messageMode: "steer",
  workspaceDefault: "worktree",
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
  };
}
