import { type ModelRef, ModelRefSchema, type Settings } from "@pi-everywhere/protocol";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { readFileIfPresent, writeFileAtomic } from "./atomic-write";
import { createSerialQueue } from "./serial-queue";

const StoredSettingsSchema = Type.Partial(
  Type.Object({
    defaultModel: Type.Union([ModelRefSchema, Type.Null()]),
    fastModel: Type.Union([ModelRefSchema, Type.Null()]),
    projectsFolder: Type.String(),
  }),
);
type StoredSettings = Type.Static<typeof StoredSettingsSchema>;

function parseStored(text: string | undefined): StoredSettings {
  if (text === undefined) return {};
  try {
    const value: unknown = JSON.parse(text);
    return Value.Check(StoredSettingsSchema, value) ? value : {};
  } catch {
    return {};
  }
}

const withDefaults = (stored: StoredSettings, defaultProjectsFolder: string): Settings => ({
  defaultModel: stored.defaultModel ?? null,
  fastModel: stored.fastModel ?? null,
  projectsFolder: stored.projectsFolder ?? defaultProjectsFolder,
});

export interface SettingsStore {
  get(): Promise<Settings>;
  setDefaultModel(ref: ModelRef): Promise<void>;
}

export function createSettingsStore(settingsFile: string, defaultProjectsFolder: string): SettingsStore {
  const enqueue = createSerialQueue();
  const readStored = async () => parseStored(await readFileIfPresent(settingsFile));
  return {
    get: () => enqueue(async () => withDefaults(await readStored(), defaultProjectsFolder)),
    setDefaultModel: (ref) =>
      enqueue(async () => {
        const next: StoredSettings = {
          ...(await readStored()),
          defaultModel: { provider: ref.provider, modelId: ref.modelId },
        };
        await writeFileAtomic(settingsFile, `${JSON.stringify(next, null, 2)}\n`);
      }),
  };
}
