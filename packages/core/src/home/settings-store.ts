import { type ModelRef, type Settings, SettingsSchema } from "@pi-everywhere/protocol";
import { Value } from "typebox/value";
import { readFileIfPresent, writeFileAtomic } from "./atomic-write";
import { createSerialQueue } from "./serial-queue";

const DEFAULT_SETTINGS: Settings = { defaultModel: null };

function parseSettings(text: string | undefined): Settings {
  if (text === undefined) return DEFAULT_SETTINGS;
  try {
    const value: unknown = JSON.parse(text);
    return Value.Check(SettingsSchema, value) ? value : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export interface SettingsStore {
  get(): Promise<Settings>;
  setDefaultModel(ref: ModelRef): Promise<void>;
}

export function createSettingsStore(settingsFile: string): SettingsStore {
  const enqueue = createSerialQueue();
  const read = async () => parseSettings(await readFileIfPresent(settingsFile));
  return {
    get: () => enqueue(read),
    setDefaultModel: (ref) =>
      enqueue(async () => {
        const next: Settings = {
          ...(await read()),
          defaultModel: { provider: ref.provider, modelId: ref.modelId },
        };
        await writeFileAtomic(settingsFile, `${JSON.stringify(next, null, 2)}\n`);
      }),
  };
}
