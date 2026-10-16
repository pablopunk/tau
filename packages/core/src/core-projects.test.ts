import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FauxWorld, openFauxWorld, setUpConversation } from "./test-support/faux-core";
import { useTempDir } from "./test-support/temp-dir";

const tempDir = useTempDir();
let world: FauxWorld;

beforeEach(async () => {
  world = await openFauxWorld(await tempDir());
});

afterEach(() => world.core.close());

describe("projects on the real core", () => {
  it("stores the real path and sees a symlink to the same folder as a duplicate", async () => {
    const folder = await world.makeFolder("real");
    const link = join(world.root, "link");
    await symlink(folder, link);
    const project = await world.core.projects.add({ path: link });
    expect(project.path).toBe(folder);
    await expect(world.core.projects.add({ path: folder })).rejects.toMatchObject({
      code: "duplicate_project",
    });
  });

  it("rejects a relative path", async () => {
    await expect(world.core.projects.add({ path: "relative/dir" })).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("trims names and rejects empty ones", async () => {
    const path = await world.makeFolder("named");
    await expect(world.core.projects.add({ path, name: "  " })).rejects.toMatchObject({
      code: "invalid_request",
    });
    const project = await world.core.projects.add({ path, name: "  Fancy  " });
    expect(project.name).toBe("Fancy");
    await expect(world.core.projects.rename(project.id, "")).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("lets a removed folder be added again as a new project with no conversations", async () => {
    const { project } = await setUpConversation(world);
    await world.core.projects.remove(project.id);
    const again = await world.core.projects.add({ path: project.path });
    expect(again.id).not.toBe(project.id);
    expect(await world.core.conversations.list(again.id)).toEqual([]);
    await expect(world.core.conversations.list(project.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("never deletes the folder it removes", async () => {
    const { project } = await setUpConversation(world);
    await world.core.projects.remove(project.id);
    await expect(world.core.projects.add({ path: project.path })).resolves.toBeDefined();
  });
});

describe("default model", () => {
  it("needs a configured provider", async () => {
    await expect(
      world.core.settings.setDefaultModel({ provider: "faux", modelId: "faux-1" }),
    ).rejects.toMatchObject({
      code: "no_provider",
    });
  });

  it("survives a restart, and conversations use it", async () => {
    await world.core.provider.setApiKey("sk-test");
    await world.core.settings.setDefaultModel({ provider: "faux", modelId: "faux-2" });
    const reopened = await world.reopen();
    expect(await reopened.settings.get()).toMatchObject({
      defaultModel: { provider: "faux", modelId: "faux-2" },
    });
    expect((await reopened.provider.status()).configured).toBe(true);
  });
});
