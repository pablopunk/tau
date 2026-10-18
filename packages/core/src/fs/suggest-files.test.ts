import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearFileListCache } from "./list-project-paths";
import { suggestFiles } from "./suggest-files";

let folder: string;

async function put(path: string) {
  await mkdir(dirname(join(folder, path)), { recursive: true });
  await writeFile(join(folder, path), "x");
}

beforeEach(async () => {
  folder = await realpath(await mkdtemp(join(tmpdir(), "tau-files-")));
  clearFileListCache();
});
afterEach(() => rm(folder, { recursive: true, force: true }));

describe("suggestFiles in a plain folder", () => {
  it("ranks basename prefix, then substring, then path substring", async () => {
    for (const path of ["lib/app-util.ts", "src/app.ts", "app/readme.md", "x/myapp.ts"]) await put(path);
    const paths = (await suggestFiles(folder, "APP")).map((entry) => entry.path);
    expect(paths).toEqual(["app", "src/app.ts", "lib/app-util.ts", "x/myapp.ts", "app/readme.md"]);
  });

  it("skips dot dirs, node_modules and symlinks and caps depth", async () => {
    for (const path of ["src/a.ts", ".hidden/a.ts", "node_modules/a/a.ts", "d1/d2/d3/d4/a.ts"])
      await put(path);
    await symlink(join(folder, "src"), join(folder, "link"));
    const all = (await suggestFiles(folder, "a")).map((entry) => entry.path);
    expect(all).toContain("src/a.ts");
    expect(all).not.toContain(".hidden/a.ts");
    expect(all.some((path) => path.startsWith("node_modules") || path.startsWith("link"))).toBe(false);
    expect(all).not.toContain("d1/d2/d3/d4/a.ts");
  });

  it("answers the 20 shortest paths for an empty query", async () => {
    for (let index = 0; index < 30; index++) await put(`f${index}.txt`);
    expect(await suggestFiles(folder, "")).toHaveLength(20);
  });

  it("answers nothing for queries that leave the folder", async () => {
    await put("a.ts");
    for (const query of ["..", "a/../b", "/etc", "~/x"])
      expect(await suggestFiles(folder, query)).toEqual([]);
  });
});

describe("suggestFiles in a repository", () => {
  it("lists tracked and untracked files, derives directories, hides ignored files", async () => {
    await promisify(execFile)("git", ["init", "-q", folder]);
    await writeFile(join(folder, ".gitignore"), "ignored.txt\n");
    for (const path of ["ignored.txt", "src/kept.ts", ".config/dot.ts"]) await put(path);
    const paths = (await suggestFiles(folder, "")).map((entry) => entry.path);
    expect(paths).toContain("src/kept.ts");
    expect(paths).toContain("src");
    expect(paths).toContain(".config/dot.ts");
    expect(paths).not.toContain("ignored.txt");
  });
});
