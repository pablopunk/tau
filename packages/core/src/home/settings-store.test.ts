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
  voiceModel: null,
  projectsFolder: PROJECTS,
  messageMode: "steer",
  workspaceDefault: "per-project",
  claudeCliNoticeAt: null,
  setupSkipped: false,
  claudeConnectors: { disabled: [], alwaysAllow: [], askBeforeWrites: false },
  remote: { enabled: false },
  resources: {
    levels: { main: "off", worktree: "off", subagent: "off" },
  },
  compaction: { mode: "summary", backend: "auto" },
};
const ref = { provider: "openrouter", modelId: "x/y" };

describe("settings store", () => {
  it("loads a settings.json from before remote access with remote off, and stores the switch", async () => {
    const file = join(await tempDir(), "settings.json");
    await writeFile(file, JSON.stringify({ messageMode: "queue" }));
    const store = createSettingsStore(file, PROJECTS);
    expect((await store.get()).remote).toEqual({ enabled: false });
    await store.setRemoteEnabled(true);
    expect((await store.get()).remote).toEqual({ enabled: true });
    expect((await store.get()).messageMode).toBe("queue");
  });

  it("ignores a malformed remote field", async () => {
    const file = join(await tempDir(), "settings.json");
    await writeFile(file, JSON.stringify({ remote: { enabled: "yes" } }));
    expect((await createSettingsStore(file, PROJECTS).get()).remote).toEqual({ enabled: false });
  });

  it("defaults askBeforeWrites to false for connector settings stored without it", async () => {
    const file = join(await tempDir(), "settings.json");
    await writeFile(file, JSON.stringify({ claudeConnectors: { disabled: [], alwaysAllow: [] } }));
    const store = createSettingsStore(file, PROJECTS);
    expect((await store.get()).claudeConnectors).toEqual({
      disabled: [],
      alwaysAllow: [],
      askBeforeWrites: false,
    });
  });

  it("drops a legacy opt-in `enabled` list so every connector starts on", async () => {
    const file = join(await tempDir(), "settings.json");
    await writeFile(
      file,
      JSON.stringify({
        claudeConnectors: {
          enabled: ["claude.ai Linear"],
          alwaysAllow: ["mcp__claude_ai_Linear__save_comment"],
          askBeforeWrites: true,
        },
      }),
    );
    expect((await createSettingsStore(file, PROJECTS).get()).claudeConnectors).toEqual({
      disabled: [],
      alwaysAllow: ["mcp__claude_ai_Linear__save_comment"],
      askBeforeWrites: true,
    });
  });

  it("stores askBeforeWrites", async () => {
    const store = createSettingsStore(join(await tempDir(), "settings.json"), PROJECTS);
    await store.setClaudeConnectors({ disabled: [], alwaysAllow: [], askBeforeWrites: true });
    expect((await store.get()).claudeConnectors.askBeforeWrites).toBe(true);
  });

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

  it("remembers the last workspace mode per project", async () => {
    const path = join(await tempDir(), "settings.json");
    await createSettingsStore(path, PROJECTS).setLastWorkspaceMode("p1", "checkout");
    const store = createSettingsStore(path, PROJECTS);
    expect(await store.lastWorkspaceMode("p1")).toBe("checkout");
    expect(await store.lastWorkspaceMode("p2")).toBeUndefined();
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

  it("stores a voice model, loads it back, and drops an invalid one", async () => {
    const path = join(await tempDir(), "settings.json");
    const store = createSettingsStore(path, PROJECTS);
    expect((await store.get()).voiceModel).toBeNull();
    await store.setVoiceModel({ kind: "local" });
    expect((await store.get()).voiceModel).toEqual({ kind: "local" });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ voiceModel: { kind: "local" } });
    const provided = { kind: "provider", provider: "openrouter", modelId: "m" } as const;
    await store.setVoiceModel(provided);
    expect((await store.get()).voiceModel).toEqual(provided);
    await store.setVoiceModel(null);
    expect((await store.get()).voiceModel).toBeNull();
    await writeFile(path, JSON.stringify({ voiceModel: { kind: "provider" } }));
    expect((await createSettingsStore(path, PROJECTS).get()).voiceModel).toBeNull();
  });

  it("falls back to the defaults for a corrupt file", async () => {
    const path = join(await tempDir(), "settings.json");
    await writeFile(path, "{ nope");
    expect(await createSettingsStore(path, PROJECTS).get()).toEqual(DEFAULTS);
    await writeFile(path, JSON.stringify({ defaultModel: 3 }));
    expect(await createSettingsStore(path, PROJECTS).get()).toEqual(DEFAULTS);
  });
});

describe("setupSkipped", () => {
  it("is false until set, persists as true and is dropped again when cleared", async () => {
    const path = join(await tempDir(), "settings.json");
    const store = createSettingsStore(path, PROJECTS);
    expect((await store.get()).setupSkipped).toBe(false);
    await store.setSetupSkipped(true);
    expect((await createSettingsStore(path, PROJECTS).get()).setupSkipped).toBe(true);
    await store.setSetupSkipped(false);
    expect((await createSettingsStore(path, PROJECTS).get()).setupSkipped).toBe(false);
    expect(JSON.parse(await readFile(path, "utf8"))).not.toHaveProperty("setupSkipped");
  });

  it("ignores anything but true in the file", async () => {
    const path = join(await tempDir(), "settings.json");
    await writeFile(path, JSON.stringify({ setupSkipped: "yes" }));
    expect((await createSettingsStore(path, PROJECTS).get()).setupSkipped).toBe(false);
  });
});

describe("resources", () => {
  const read = async (stored: unknown) => {
    const path = join(await tempDir(), "settings.json");
    await writeFile(path, JSON.stringify({ resources: stored }));
    return (await createSettingsStore(path, PROJECTS).get()).resources;
  };

  it("is Off when the field is missing", async () => {
    const path = join(await tempDir(), "settings.json");
    await writeFile(path, JSON.stringify({}));
    expect((await createSettingsStore(path, PROJECTS).get()).resources).toEqual(DEFAULTS.resources);
  });

  it("keeps valid fields and defaults each invalid or missing one on its own", async () => {
    expect(await read({ levels: { main: "balanced" }, heavySlots: 99, memoryLimitMb: 10 })).toEqual({
      levels: { main: "balanced", worktree: "off", subagent: "off" },
    });
    expect(await read({ heavySlots: 3, memoryLimitMb: 2048, levels: { main: "nope" } })).toMatchObject({
      levels: { main: "off", worktree: "off", subagent: "off" },
    });
    expect(await read("garbage")).toEqual(DEFAULTS.resources);
  });

  it("stores the value whole and reads it back", async () => {
    const path = join(await tempDir(), "settings.json");
    const value = {
      levels: { main: "background", worktree: "balanced", subagent: "off" } as const,
    };
    await createSettingsStore(path, PROJECTS).setResources(value);
    expect((await createSettingsStore(path, PROJECTS).get()).resources).toEqual(value);
  });

  it("defaults compaction to summary/auto and stores the value whole", async () => {
    const path = join(await tempDir(), "settings.json");
    await writeFile(path, JSON.stringify({}));
    expect((await createSettingsStore(path, PROJECTS).get()).compaction).toEqual({
      mode: "summary",
      backend: "auto",
    });
    await createSettingsStore(path, PROJECTS).setCompaction({ mode: "fast", backend: "typesafe" });
    expect((await createSettingsStore(path, PROJECTS).get()).compaction).toEqual({
      mode: "fast",
      backend: "typesafe",
    });
  });

  it("migrates a legacy {priority, appliesTo} setting to per-scope levels", async () => {
    expect(
      await read({
        priority: "balanced",
        heavySlots: 2,
        appliesTo: { main: true, worktrees: false, subagents: false },
      }),
    ).toEqual({
      levels: { main: "balanced", worktree: "off", subagent: "off" },
    });
    expect(await read({ priority: "background" })).toMatchObject({
      levels: { main: "off", worktree: "off", subagent: "background" },
    });
  });
});
