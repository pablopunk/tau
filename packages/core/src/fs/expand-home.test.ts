import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openFauxWorld } from "../test-support/faux-core";
import { useTempDir } from "../test-support/temp-dir";
import { collapseHome, expandHome } from "./expand-home";

const tempDir = useTempDir();
let home: string;

beforeEach(async () => {
  home = await tempDir();
  vi.stubEnv("HOME", home);
});
afterEach(() => vi.unstubAllEnvs());

describe("expandHome", () => {
  it("expands ~ and ~/ only at the start", () => {
    expect(expandHome("~")).toBe(home);
    expect(expandHome("~/src/app")).toBe(join(home, "src/app"));
    expect(expandHome("~other/x")).toBe("~other/x");
    expect(expandHome("/a/~/b")).toBe("/a/~/b");
    expect(expandHome("relative")).toBe("relative");
  });

  it("collapses the home folder back to ~", () => {
    expect(collapseHome(home)).toBe("~");
    expect(collapseHome(join(home, "a"))).toBe("~/a");
    expect(collapseHome(`${home}-sibling`)).toBe(`${home}-sibling`);
  });
});

describe("~ in paths the core accepts", () => {
  it("expands it in projects.add and stores the real path", async () => {
    const world = await openFauxWorld(await tempDir());
    await mkdir(join(home, "tilde-app"));
    const project = await world.core.projects.add({ path: "~/tilde-app" });
    expect(project.path).toBe(join(home, "tilde-app"));
    await world.core.close();
  });

  it("expands it in settings.setProjectsFolder and creates the folder", async () => {
    const world = await openFauxWorld(await tempDir());
    await world.core.settings.setProjectsFolder("~/new-projects");
    expect((await world.core.settings.get()).projectsFolder).toBe(join(home, "new-projects"));
    await world.core.close();
  });

  it("still rejects a missing folder and a relative path", async () => {
    const world = await openFauxWorld(await tempDir());
    await expect(world.core.projects.add({ path: "~/missing" })).rejects.toMatchObject({
      code: "path_not_found",
    });
    await expect(world.core.projects.add({ path: "relative" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await world.core.close();
  });
});
