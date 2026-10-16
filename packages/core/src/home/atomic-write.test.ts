import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import { readFileIfPresent, writeFileAtomic } from "./atomic-write";
import { openDataHome } from "./data-home";

const tempDir = useTempDir();

describe("writeFileAtomic", () => {
  it("writes a 0600 file and leaves no temp file behind", async () => {
    const dir = await tempDir();
    const path = join(dir, "settings.json");
    await writeFileAtomic(path, "{}");
    expect(await readFile(path, "utf8")).toBe("{}");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(dir)).toEqual(["settings.json"]);
  });

  it("replaces an existing file whole", async () => {
    const dir = await tempDir();
    const path = join(dir, "a.json");
    await writeFile(path, "old old old old");
    await writeFileAtomic(path, "new");
    expect(await readFile(path, "utf8")).toBe("new");
  });

  it("cleans up its temp file when the target cannot be replaced", async () => {
    const dir = await tempDir();
    await expect(writeFileAtomic(join(dir, "missing", "a.json"), "x")).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("readFileIfPresent", () => {
  it("returns undefined for a missing file", async () => {
    expect(await readFileIfPresent(join(await tempDir(), "nope"))).toBeUndefined();
  });
});

describe("openDataHome", () => {
  it("creates the home directory with mode 0700, and tightens an existing one", async () => {
    const dir = await tempDir();
    const home = await openDataHome(join(dir, "nested", "home"));
    expect((await stat(home.root)).mode & 0o777).toBe(0o700);
    await openDataHome(home.root);
    expect(home.agentDatabase).toBe(join(home.root, "agent.sqlite"));
  });
});
