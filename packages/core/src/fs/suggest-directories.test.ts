import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import { suggestDirectories } from "./suggest-directories";

const tempDir = useTempDir();
let home: string;

beforeEach(async () => {
  home = await tempDir();
  vi.stubEnv("HOME", home);
});
afterEach(() => vi.unstubAllEnvs());

const folders = (...names: string[]) =>
  Promise.all(names.map((name) => mkdir(join(home, name), { recursive: true })));
const pathsFor = async (prefix: string, limit?: number) =>
  (await suggestDirectories({ prefix, limit })).map((item) => item.path);

describe("suggestDirectories", () => {
  it("lists folders only, matching the prefix case-insensitively", async () => {
    await folders("src", "Sandbox", "docs");
    await writeFile(join(home, "sr-file.txt"), "x");
    expect(await pathsFor("~/s")).toEqual([join(home, "Sandbox"), join(home, "src")]);
  });

  it("puts an exact match first, then sorts alphabetically", async () => {
    await folders("app-b", "app", "app-a");
    expect(await pathsFor("~/app")).toEqual([join(home, "app"), join(home, "app-a"), join(home, "app-b")]);
  });

  it("shows ~ in display and marks repositories", async () => {
    await folders("code/.git", "code-plain");
    const [repo, plain] = await suggestDirectories({ prefix: "~/code" });
    expect(repo).toEqual({ path: join(home, "code"), display: "~/code", isGitRepo: true });
    expect(plain).toMatchObject({ display: "~/code-plain", isGitRepo: false });
  });

  it("hides dot folders unless the partial starts with a dot", async () => {
    await folders(".config", "cache");
    expect(await pathsFor("~/")).toEqual([join(home, "cache")]);
    expect(await pathsFor("~/.")).toEqual([join(home, ".config")]);
  });

  it("follows a symlink only when it points to a folder", async () => {
    await folders("target");
    await writeFile(join(home, "file.txt"), "x");
    await symlink(join(home, "target"), join(home, "link-dir"));
    await symlink(join(home, "file.txt"), join(home, "link-file"));
    await symlink(join(home, "nowhere"), join(home, "link-broken"));
    expect(await pathsFor("~/link")).toEqual([join(home, "link-dir")]);
  });

  it("suggests from home for an empty, relative or bare ~ prefix", async () => {
    await folders("alpha");
    expect(await pathsFor("")).toEqual([join(home, "alpha")]);
    expect(await pathsFor("al")).toEqual([join(home, "alpha")]);
    expect(await pathsFor("~")).toEqual([join(home, "alpha")]);
  });

  it("goes into a typed folder and keeps absolute paths absolute", async () => {
    await folders("a/inner");
    expect(await pathsFor(`${join(home, "a")}/`)).toEqual([join(home, "a", "inner")]);
    expect((await suggestDirectories({ prefix: `${join(home, "a")}/in` }))[0]?.display).toBe("~/a/inner");
  });

  it("honours the limit and defaults to 50", async () => {
    await folders(...Array.from({ length: 60 }, (_, index) => `n${String(index).padStart(2, "0")}`));
    expect(await pathsFor("~/n", 3)).toHaveLength(3);
    expect(await pathsFor("~/n")).toHaveLength(50);
  });

  it("returns [] for a missing or unreadable folder", async () => {
    expect(await pathsFor("~/missing/x")).toEqual([]);
    await folders("locked/inner");
    await chmod(join(home, "locked"), 0o000);
    expect(await pathsFor("~/locked/")).toEqual([]);
    await chmod(join(home, "locked"), 0o700);
  });
});
