import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import { pickLocalCopy, SCAN_ENTRY_LIMIT, scanLocalRepos } from "./local-scan";

const tempDir = useTempDir();

const GITHUB = "https://github.com/me/repo.git";

const remotesByName: Record<string, string[]> = {};
const readRemotes = async (directory: string) => remotesByName[directory.split("/").at(-1) ?? ""] ?? [GITHUB];

async function makeRepo(path: string, kind: "directory" | "file" = "directory") {
  await mkdir(path, { recursive: true });
  if (kind === "directory") await mkdir(join(path, ".git"));
  else await writeFile(join(path, ".git"), "gitdir: /elsewhere/.git/worktrees/x");
}

const scan = async (code: string, home = "/nowhere") =>
  (await scanLocalRepos(code, home, readRemotes)).copies;

describe("scanLocalRepos", () => {
  it("finds repositories two levels deep, including worktrees with a .git file", async () => {
    const code = await tempDir();
    await makeRepo(join(code, "top"));
    await makeRepo(join(code, "group", "nested"), "file");
    const copies = await scan(code);
    expect(copies.get("github.com/me/repo")?.toSorted()).toEqual([
      join(code, "group", "nested"),
      join(code, "top"),
    ]);
  });

  it("does not descend into a repository, past depth 2, dot-directories or node_modules", async () => {
    const code = await tempDir();
    await makeRepo(join(code, "outer"));
    await makeRepo(join(code, "outer", "inner"));
    await makeRepo(join(code, "a", "b", "too-deep"));
    await makeRepo(join(code, ".hidden"));
    await makeRepo(join(code, "node_modules", "pkg"));
    await makeRepo(join(code, "group", ".cache"));
    expect([...(await scan(code)).values()].flat()).toEqual([join(code, "outer")]);
  });

  it("never follows symlinks", async () => {
    const code = await tempDir();
    const outside = await tempDir();
    await makeRepo(join(outside, "elsewhere"));
    await symlink(join(outside, "elsewhere"), join(code, "link"));
    await symlink(outside, join(code, "folder-link"));
    expect((await scan(code)).size).toBe(0);
  });

  it("counts every remote and keeps the paths of copies apart per key", async () => {
    const code = await tempDir();
    await makeRepo(join(code, "fork"));
    remotesByName.fork = ["git@github.com:me/repo.git", "https://github.com/upstream/repo"];
    const copies = await scan(code);
    delete remotesByName.fork;
    expect(copies.get("github.com/me/repo")).toEqual([join(code, "fork")]);
    expect(copies.get("github.com/upstream/repo")).toEqual([join(code, "fork")]);
  });

  it("refuses the file system root and the home folder", async () => {
    const home = await tempDir();
    await makeRepo(join(home, "repo"));
    expect((await scan(home, home)).size).toBe(0);
    expect((await scan("/", home)).size).toBe(0);
  });

  it("answers nothing for a missing folder", async () => {
    expect((await scan(join(await tempDir(), "missing"))).size).toBe(0);
  });

  it("stops after the entry limit", async () => {
    const code = await tempDir();
    await Promise.all(
      Array.from({ length: SCAN_ENTRY_LIMIT + 50 }, (_, index) =>
        mkdir(join(code, `r${index}`, ".git"), { recursive: true }),
      ),
    );
    const found = [...(await scan(code)).values()].flat();
    expect(found.length).toBeLessThanOrEqual(SCAN_ENTRY_LIMIT);
    expect(found.length).toBeGreaterThan(0);
  });
});

describe("pickLocalCopy", () => {
  it("prefers <code folder>/<repo>, then the shortest path", () => {
    const code = "/code";
    expect(pickLocalCopy(["/code/a/repo", "/code/repo"], code, "repo")).toBe("/code/repo");
    expect(pickLocalCopy(["/code/group/repo", "/code/x"], code, "repo")).toBe("/code/x");
    expect(pickLocalCopy([], code, "repo")).toBeUndefined();
  });
});
