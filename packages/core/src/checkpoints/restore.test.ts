import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { useTempDir } from "../test-support/temp-dir";
import { type Repo, repoOf } from "./repo";
import { applyRestore, planRestore } from "./restore";
import { deleteRefsOf, indexFileOf, refOf, takeSnapshot, takeTree } from "./snapshot";
import { changedFiles } from "./tree-diff";
import { requireRepoRelative } from "./validate-path";

const run = promisify(execFile);
const identity = ["-c", "user.name=T", "-c", "user.email=t@example.com"];
const tempDir = useTempDir();

let home: string;
let root: string;
let repo: Repo;

const git = async (...args: string[]) => (await run("git", ["-C", root, ...identity, ...args])).stdout;
const write = async (path: string, text: string) => {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), text);
};
const text = (path: string) => readFile(join(root, path), "utf8");
const exists = (path: string) =>
  lstat(join(root, path)).then(
    () => true,
    () => false,
  );
const target = (conversationId = "1") => ({ home, conversationId, repo });
const snapshot = (conversationId = "1", name: string | number = 1) =>
  takeSnapshot(target(conversationId), refOf(conversationId, name));

async function restoreTo(sha: string) {
  const steps = await planRestore(repo, sha, await takeTree(target()));
  await applyRestore(repo, steps);
  return steps;
}

beforeEach(async () => {
  const base = await tempDir();
  home = join(base, "home");
  root = join(base, "repo");
  await mkdir(root, { recursive: true });
  await git("init", "--quiet");
  await write(".gitignore", "ignored.log\nnode_modules/\n");
  await write("kept.txt", "kept\n");
  await write("app/src/main.ts", "export {};\n");
  await write("tool.sh", "#!/bin/sh\n");
  await chmod(join(root, "tool.sh"), 0o755);
  await git("add", ".");
  await git("commit", "--quiet", "-m", "first");
  repo = (await repoOf(join(root, "app"))) as Repo;
});

describe("checkpoint snapshots and restore", () => {
  it("finds the repository top level from a subfolder", () => {
    expect(repo.root).toBe(root);
  });

  it("returns to a snapshot exactly: untracked, deleted, renamed, spaces, exec bit, symlink", async () => {
    await write("with space/new file.txt", "untracked\n");
    await symlink("kept.txt", join(root, "link"));
    const before = await snapshot();

    await write("with space/new file.txt", "changed\n");
    await write("added later.txt", "extra\n");
    await write("deep/er/file.txt", "deep\n");
    await rm(join(root, "kept.txt"));
    await rename(join(root, "app/src/main.ts"), join(root, "app/src/renamed.ts"));
    await chmod(join(root, "tool.sh"), 0o644);
    await rm(join(root, "link"));
    await symlink("elsewhere", join(root, "link"));
    await restoreTo(before);

    expect(await text("with space/new file.txt")).toBe("untracked\n");
    expect(await text("kept.txt")).toBe("kept\n");
    expect(await text("app/src/main.ts")).toBe("export {};\n");
    expect(await exists("app/src/renamed.ts")).toBe(false);
    expect(await exists("added later.txt")).toBe(false);
    expect(await exists("deep/er/file.txt")).toBe(false);
    expect((await stat(join(root, "tool.sh"))).mode & 0o111).toBeTruthy();
    expect(await readlink(join(root, "link"))).toBe("kept.txt");
    expect(await takeTree(target())).toBe(await takeTree(target("2")));
  });

  it("restores to a state that is tree-identical to the snapshot", async () => {
    const before = await snapshot();
    await write("kept.txt", "other\n");
    await write("brand-new.txt", "x\n");
    await restoreTo(before);
    expect((await git("rev-parse", `${before}^{tree}`)).trim()).toBe(await takeTree(target()));
  });

  it("never touches ignored files", async () => {
    const before = await snapshot();
    await write("ignored.log", "log\n");
    await write("node_modules/pkg/index.js", "module\n");
    await write("kept.txt", "changed\n");
    const steps = await restoreTo(before);
    expect(steps.map((step) => step.path)).toEqual(["kept.txt"]);
    expect(await text("ignored.log")).toBe("log\n");
    expect(await exists("node_modules/pkg/index.js")).toBe(true);
  });

  it("leaves the user's index, branch and stash untouched", async () => {
    const indexBefore = await readFile(join(root, ".git/index"));
    const statusBefore = await git("status", "--porcelain");
    await write("untracked.txt", "u\n");
    await snapshot();
    expect((await git("status", "--porcelain")).replace("?? untracked.txt\n", "")).toBe(statusBefore);
    expect(await readFile(join(root, ".git/index"))).toEqual(indexBefore);
    expect((await git("branch", "--list")).trim()).toMatch(/^\*/);
    expect(await git("stash", "list")).toBe("");
    expect((await lstat(indexFileOf(home, "1"))).isFile()).toBe(true);
  });

  it("skips nested repositories", async () => {
    await mkdir(join(root, "nested"), { recursive: true });
    await run("git", ["-C", join(root, "nested"), "init", "--quiet"]);
    await write("nested/inner.txt", "inner\n");
    await run("git", ["-C", join(root, "nested"), "add", "."]);
    await run("git", ["-C", join(root, "nested"), ...identity, "commit", "--quiet", "-m", "inner"]);
    await mkdir(join(root, "empty-nested"), { recursive: true });
    await run("git", ["-C", join(root, "empty-nested"), "init", "--quiet"]);
    const before = await snapshot();
    await write("nested/inner.txt", "changed\n");
    await rm(join(root, "kept.txt"));
    const steps = await restoreTo(before);
    expect(steps.map((step) => step.path)).toEqual(["kept.txt"]);
    expect(await text("nested/inner.txt")).toBe("changed\n");
  });

  it("replaces a symlink that took a folder's place without writing outside the repository", async () => {
    const outside = join(root, "..", "outside");
    await mkdir(outside, { recursive: true });
    await write("dir/file.txt", "inside\n");
    const before = await snapshot();
    await rm(join(root, "dir"), { recursive: true });
    await symlink(outside, join(root, "dir"));
    await restoreTo(before);
    expect(await text("dir/file.txt")).toBe("inside\n");
    expect(await exists("../outside/file.txt")).toBe(false);
  });

  it("refuses a write whose parent folder resolves outside the repository", async () => {
    const outside = join(root, "..", "outside");
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(root, "escape"));
    const step = { path: "escape/file.txt", action: "write" as const, mode: "100644", oid: "0".repeat(40) };
    await expect(applyRestore(repo, [step])).rejects.toThrow(/outside the repository/);
  });

  it("lists per-file added and removed lines between snapshots", async () => {
    const before = await snapshot();
    await write("kept.txt", "kept\nmore\nlines\n");
    await write("new.txt", "one\n");
    await rm(join(root, "tool.sh"));
    const after = await snapshot("1", 2);
    const files = await changedFiles(repo, before, after);
    expect(files).toEqual(
      expect.arrayContaining([
        { path: "kept.txt", added: 2, removed: 0, status: "M" },
        { path: "new.txt", added: 1, removed: 0, status: "A" },
        { path: "tool.sh", added: 0, removed: 1, status: "D" },
      ]),
    );
  });

  it("keeps a ref per snapshot and deletes them all with the thread", async () => {
    await snapshot("7", 1);
    await snapshot("7", 2);
    await snapshot("8", 1);
    const refs = () => git("for-each-ref", "--format=%(refname)", "refs/tau/");
    expect((await refs()).trim().split("\n")).toHaveLength(3);
    await deleteRefsOf(repo.commonDir, "7");
    expect((await refs()).trim()).toBe("refs/tau/8/1");
  });
});

describe("checkpoints stored under the old ref prefix", () => {
  it("are deleted with the thread", async () => {
    await snapshot("9", 1);
    const sha = (await git("rev-parse", "refs/tau/9/1")).trim();
    await git("update-ref", "refs/pi-everywhere/9/1", sha);
    await git("update-ref", "-d", "refs/tau/9/1");
    await deleteRefsOf(repo.commonDir, "9");
    expect((await git("for-each-ref", "--format=%(refname)", "refs/pi-everywhere/")).trim()).toBe("");
  });
});

describe("requireRepoRelative", () => {
  it.each(["", "../x", "a/../../x", "/etc/passwd", "a\0b"])("rejects %j", (path) => {
    expect(() => requireRepoRelative(path)).toThrow();
  });

  it("accepts a nested path with spaces", () => {
    expect(requireRepoRelative("a b/c.txt")).toBe("a b/c.txt");
  });
});
