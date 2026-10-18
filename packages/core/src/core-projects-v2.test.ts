import { symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineDoc } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChangeEmitter } from "./change-emitter";
import { BACKGROUND, openAgentHarness, openSqliteStorage } from "./harness/open";
import { openDataHome } from "./home/data-home";
import { createSettingsStore } from "./home/settings-store";
import { createProviderService } from "./provider/provider-service";
import { type FauxWorld, openFauxWorld } from "./test-support/faux-core";
import { useTempDir } from "./test-support/temp-dir";
import { makeRepo } from "./workspaces/workspace-test-support";

const tempDir = useTempDir();
let world: FauxWorld;

beforeEach(async () => {
  world = await openFauxWorld(await tempDir());
});

afterEach(() => world.core.close());

const MvpProjectsDoc = defineDoc<{
  projects: { id: string; name: string; path: string; createdAt: number }[];
}>({
  kind: "app.projects",
  version: 1,
  scope: "session",
  initial: () => ({ projects: [] }),
});

async function writeMvpProject(home: string, path: string) {
  const dataHome = await openDataHome(home);
  const provider = createProviderService({
    credentialsFile: dataHome.credentialsFile,
    faux: true,
    env: {},
    changes: createChangeEmitter(),
    settings: createSettingsStore(dataHome.settingsFile, home),
  });
  const harness = await openAgentHarness({
    storage: await openSqliteStorage(dataHome.agentDatabase),
    models: provider.models,
  });
  await harness.commit(async (tx) => {
    (await tx.doc(MvpProjectsDoc)).projects.push({ id: "old", name: "Old", path, createdAt: 7 });
  }, BACKGROUND);
  await harness.close(BACKGROUND);
}

describe("app.projects v2 migration", () => {
  it("reports a project stored as a plain folder inside a repository as a git repo", async () => {
    await world.core.close();
    const { repo } = await makeRepo();
    await writeMvpProject(world.home, repo);
    const core = await world.reopen();
    expect(await core.projects.list()).toContainEqual(
      expect.objectContaining({ id: "old", isGitRepo: true }),
    );
  });

  it("turns an MVP project into a ready folder project", async () => {
    await world.core.close();
    const path = await world.makeFolder("mvp");
    await writeMvpProject(world.home, path);
    const core = await world.reopen();
    expect(await core.projects.list()).toEqual([
      expect.objectContaining({ id: "home", kind: "home" }),
      {
        id: "old",
        name: "Old",
        path,
        createdAt: 7,
        kind: "folder",
        status: "ready",
        isGitRepo: false,
        iconUrl: "/api/projects/old/icon?v=auto",
      },
    ]);
  });
});

describe("the Home project", () => {
  it("is first, ready, and at the home folder", async () => {
    const [home] = await world.core.projects.list();
    expect(home).toMatchObject({ id: "home", kind: "home", name: "Home", path: homedir(), status: "ready" });
  });

  it("cannot be added again, renamed or removed", async () => {
    await expect(world.core.projects.add({ path: homedir() })).rejects.toMatchObject({
      code: "duplicate_project",
    });
    await expect(world.core.projects.rename("home", "Mine")).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(world.core.projects.remove("home")).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("settings", () => {
  it("creates the projects folder, stores its real path and keeps it after a restart", async () => {
    const real = await world.makeFolder("real-root");
    const link = join(world.root, "link-root");
    await symlink(real, link);
    await world.core.settings.setProjectsFolder(join(link, "nested", "deeper"));
    const expected = join(real, "nested", "deeper");
    expect((await world.core.settings.get()).projectsFolder).toBe(expected);
    expect((await (await world.reopen()).settings.get()).projectsFolder).toBe(expected);
  });

  it("stores the fast model, which survives a restart, and clears it with null", async () => {
    await world.core.providers.setApiKey("openrouter", "sk-test");
    const [model] = await world.core.models.list();
    const ref = { provider: model?.provider ?? "", modelId: model?.modelId ?? "" };
    await world.core.settings.setFastModel(ref);
    expect((await (await world.reopen()).settings.get()).fastModel).toEqual(ref);
    await world.core.settings.setFastModel(null);
    expect((await world.core.settings.get()).fastModel).toBeNull();
  });

  it("needs a provider for a fast model", async () => {
    await expect(
      world.core.settings.setFastModel({ provider: "faux", modelId: "faux-1" }),
    ).rejects.toMatchObject({
      code: "no_provider",
    });
  });
});
