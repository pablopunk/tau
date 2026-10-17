import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import { createSettingsStore } from "./settings-store";

const tempDir = useTempDir();
const PROJECTS = "/data/projects";
const DEFAULTS = {
  defaultModel: null,
  defaultThinkingLevel: null,
  fastModel: null,
  fastThinkingLevel: null,
  projectsFolder: PROJECTS,
  messageMode: "steer",
  workspaceDefault: "worktree",
};
const ref = { provider: "openrouter", modelId: "x/y" };

describe("settings store", () => {
  it("starts without a default model", async () => {
    const store = createSettingsStore(join(await tempDir(), "settings.json"), PROJECTS);
    expect(await store.get()).toEqual(DEFAULTS);
  });

  it("persists the default model in a 0600 file", async () => {
    const path = join(await tempDir(), "settings.json");
    await createSettingsStore(path, PROJECTS).setDefaultModel(ref, null);
    expect(await createSettingsStore(path, PROJECTS).get()).toEqual({ ...DEFAULTS, defaultModel: ref });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ defaultModel: ref });
  });

  it("keeps the model of an MVP settings file and fills the new fields", async () => {
    const path = join(await tempDir(), "settings.json");
    await writeFile(path, JSON.stringify({ defaultModel: ref }));
    expect(await createSettingsStore(path, PROJECTS).get()).toEqual({ ...DEFAULTS, defaultModel: ref });
  });

  it("keeps the valid fields when another one is invalid", async () => {
    const path = join(await tempDir(), "settings.json");
    await writeFile(path, JSON.stringify({ defaultModel: ref, fastModel: 3, projectsFolder: "/x" }));
    expect(await createSettingsStore(path, PROJECTS).get()).toEqual({
      ...DEFAULTS,
      defaultModel: ref,
      projectsFolder: "/x",
    });
  });

  it("stores and clears the fast model and stores the projects folder", async () => {
    const path = join(await tempDir(), "settings.json");
    const store = createSettingsStore(path, PROJECTS);
    const fast = { provider: "openrouter", modelId: "fast/one" };
    await store.setDefaultModel(ref, null);
    await store.setFastModel(fast, null);
    await store.setProjectsFolder("/elsewhere");
    expect(await store.get()).toEqual({
      ...DEFAULTS,
      defaultModel: ref,
      fastModel: fast,
      projectsFolder: "/elsewhere",
    });
    await store.setFastModel(null, null);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      defaultModel: ref,
      projectsFolder: "/elsewhere",
    });
  });

  it("stores a thinking level with each model and clears the fast one with its model", async () => {
    const path = join(await tempDir(), "settings.json");
    const store = createSettingsStore(path, PROJECTS);
    await store.setDefaultModel(ref, "high");
    await store.setFastModel(ref, "low");
    expect(await createSettingsStore(path, PROJECTS).get()).toMatchObject({
      defaultThinkingLevel: "high",
      fastThinkingLevel: "low",
    });
    await store.setDefaultThinkingLevel(null);
    await store.setFastModel(null, null);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ defaultModel: ref });
  });

  it("loads a file without thinking levels as null and drops an invalid level", async () => {
    const path = join(await tempDir(), "settings.json");
    await writeFile(path, JSON.stringify({ defaultModel: ref, defaultThinkingLevel: "bogus" }));
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
