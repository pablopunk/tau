import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import { createSettingsStore } from "./settings-store";

const tempDir = useTempDir();
const PROJECTS = "/data/projects";
const DEFAULTS = { defaultModel: null, fastModel: null, projectsFolder: PROJECTS };
const ref = { provider: "openrouter", modelId: "x/y" };

describe("settings store", () => {
  it("starts without a default model", async () => {
    const store = createSettingsStore(join(await tempDir(), "settings.json"), PROJECTS);
    expect(await store.get()).toEqual(DEFAULTS);
  });

  it("persists the default model in a 0600 file", async () => {
    const path = join(await tempDir(), "settings.json");
    await createSettingsStore(path, PROJECTS).setDefaultModel(ref);
    expect(await createSettingsStore(path, PROJECTS).get()).toEqual({ ...DEFAULTS, defaultModel: ref });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ defaultModel: ref });
  });

  it("keeps the model of an MVP settings file and fills the new fields", async () => {
    const path = join(await tempDir(), "settings.json");
    await writeFile(path, JSON.stringify({ defaultModel: ref }));
    expect(await createSettingsStore(path, PROJECTS).get()).toEqual({ ...DEFAULTS, defaultModel: ref });
  });

  it("falls back to the defaults for a corrupt file", async () => {
    const path = join(await tempDir(), "settings.json");
    await writeFile(path, "{ nope");
    expect(await createSettingsStore(path, PROJECTS).get()).toEqual(DEFAULTS);
    await writeFile(path, JSON.stringify({ defaultModel: 3 }));
    expect(await createSettingsStore(path, PROJECTS).get()).toEqual(DEFAULTS);
  });
});
