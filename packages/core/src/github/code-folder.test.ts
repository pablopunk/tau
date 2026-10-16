import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SettingsStore } from "../home/settings-store";
import { useTempDir } from "../test-support/temp-dir";
import { suggestCodeFolder } from "./code-folder";

const tempDir = useTempDir();

const settingsWith = (projectsFolder: string) =>
  ({ get: async () => ({ defaultModel: null, fastModel: null, projectsFolder }) }) as SettingsStore;

async function suggest(projectsFolder: string, folders: string[]) {
  const homeDirectory = await tempDir();
  for (const name of folders) await mkdir(join(homeDirectory, name));
  const deps = { settings: settingsWith(projectsFolder), defaultProjectsFolder: "/default", homeDirectory };
  return { homeDirectory, suggestion: await suggestCodeFolder(deps) };
}

describe("suggestCodeFolder", () => {
  it("suggests the first existing candidate in order", async () => {
    const { homeDirectory, suggestion } = await suggest("/default", ["dev", "code", "projects"]);
    expect(suggestion).toEqual({ path: join(homeDirectory, "code") });
  });

  it("suggests nothing when no candidate exists", async () => {
    expect((await suggest("/default", ["other"])).suggestion).toBeNull();
  });

  it("suggests nothing once the code folder was changed", async () => {
    expect((await suggest("/somewhere", ["src"])).suggestion).toBeNull();
  });
});
