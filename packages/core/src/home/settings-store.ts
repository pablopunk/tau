import { type ModelRef, ModelRefSchema, type Settings } from "@pi-everywhere/protocol";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { readFileIfPresent, writeFileAtomic } from "./atomic-write";
import { createSerialQueue } from "./serial-queue";

type StoredSettings = { defaultModel?: ModelRef; fastModel?: ModelRef; projectsFolder?: string };

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
  if (projectsFolder) stored.projectsFolder = projectsFolder;
  return stored;
}

const withDefaults = (stored: StoredSettings, defaultProjectsFolder: string): Settings => ({
  defaultModel: stored.defaultModel ?? null,
  fastModel: stored.fastModel ?? null,
  projectsFolder: stored.projectsFolder ?? defaultProjectsFolder,
});

export interface SettingsStore {
  get(): Promise<Settings>;
  setDefaultModel(ref: ModelRef): Promise<void>;
  /** `null` clears it. */
  setFastModel(ref: ModelRef | null): Promise<void>;
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
    setDefaultModel: (ref) => update((stored) => ({ ...stored, defaultModel: copyRef(ref) })),
    setFastModel: (ref) =>
      update(({ fastModel: _dropped, ...rest }) =>
        ref === null ? rest : { ...rest, fastModel: copyRef(ref) },
      ),
    setProjectsFolder: (path) => update((stored) => ({ ...stored, projectsFolder: path })),
  };
}
