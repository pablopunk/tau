import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCore, createCoreWith, defaultCoreDependencies } from "./create-core";
import { HomeLockedError } from "./home/lock";
import { publishServerUrl, readRunningInstance } from "./running-instance";
import { openRouterCatalogIds, stubOpenRouter } from "./test-support/stub-openrouter";
import { homeIn, useTempDir } from "./test-support/temp-dir";

const tempDir = useTempDir();
afterEach(() => vi.unstubAllGlobals());

const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

describe("createCore lifecycle", () => {
  it("creates the data home privately and refuses a second core on it", async () => {
    const home = homeIn(await tempDir());
    const core = await createCore({ home, faux: true });
    expect(await modeOf(home)).toBe(0o700);
    await expect(createCore({ home, faux: true })).rejects.toBeInstanceOf(HomeLockedError);
    await core.close();
  });

  it("releases the lock on close, and close can be called twice", async () => {
    const home = homeIn(await tempDir());
    const first = await createCore({ home, faux: true });
    await Promise.all([first.close(), first.close()]);
    await first.close();
    expect(await readRunningInstance(home)).toBeUndefined();
    await (await createCore({ home, faux: true })).close();
  });

  it("lets a second launch find the URL the first one published", async () => {
    const home = homeIn(await tempDir());
    const core = await createCore({ home, faux: true });
    await publishServerUrl(home, "http://127.0.0.1:4317/?token=t");
    expect(await readRunningInstance(home)).toEqual({
      pid: process.pid,
      url: "http://127.0.0.1:4317/?token=t",
    });
    await core.close();
  });

  it("does not keep the lock when startup fails", async () => {
    const home = homeIn(await tempDir());
    await mkdir(join(home, "agent.sqlite"), { recursive: true });
    await expect(createCore({ home, faux: true })).rejects.toThrow();
    expect(await readRunningInstance(home)).toBeUndefined();
  });

  it("keeps settings and credentials private files in the home", async () => {
    const home = homeIn(await tempDir());
    const core = await createCore({ home, faux: true });
    await core.provider.setApiKey("sk-test");
    await core.settings.setDefaultModel({ provider: "faux", modelId: "faux-1" });
    expect(await modeOf(join(home, "credentials.json"))).toBe(0o600);
    expect(await modeOf(join(home, "settings.json"))).toBe(0o600);
    await core.close();
  });
});

describe("createCore with OpenRouter", () => {
  const options = (home: string, env: Record<string, string>) => ({
    options: { home },
    deps: { ...defaultCoreDependencies(), env },
  });

  it("validates the key, lists what it can use, and uses the chosen model for new conversations", async () => {
    const modelId = openRouterCatalogIds()[0] ?? "";
    const stub = stubOpenRouter({ allowedModelIds: [modelId] });
    const root = await tempDir();
    const { options: coreOptions, deps } = options(homeIn(root), {});
    const core = await createCoreWith(coreOptions, deps);
    await core.provider.setApiKey("sk-real");
    expect(stub.requests[0]?.url).toBe("https://openrouter.ai/api/v1/key");
    const models = await core.provider.listModels();
    expect(models.map((model) => model.modelId)).toEqual([modelId]);
    await core.settings.setDefaultModel({ provider: "openrouter", modelId });
    await expect(
      core.settings.setDefaultModel({ provider: "openrouter", modelId: "other/model" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const project = await core.projects.add({ path: root });
    const conversation = await core.conversations.start({
      projectId: project.id,
      text: "hello",
      requestId: "r1",
    });
    expect(conversation.projectId).toBe(project.id);
    await core.close();
  });

  it("works from OPENROUTER_API_KEY alone", async () => {
    stubOpenRouter();
    const { options: coreOptions, deps } = options(homeIn(await tempDir()), { OPENROUTER_API_KEY: "sk-env" });
    const core = await createCoreWith(coreOptions, deps);
    expect(await core.provider.status()).toEqual({
      provider: "openrouter",
      configured: true,
      source: "env",
      valid: true,
    });
    await core.close();
  });
});
