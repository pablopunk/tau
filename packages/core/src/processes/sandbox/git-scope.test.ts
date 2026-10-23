import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { classifySharedGitWrite, type GitScope, gitReadWritePaths, ownRefPaths } from "./git-scope";

const run = promisify(execFile);

const scopeFor = (main: string, worktree: string, branch: string): GitScope => ({
  worktreeRoot: worktree,
  adminDir: join(main, ".git", "worktrees", "wt-1"),
  sharedGitDir: join(main, ".git"),
  branch,
});

describe("git allowlist", () => {
  const scope = scopeFor("/main", "/wt", "feature/x");

  it("writes the checkout, the own admin dir, objects and the own ref", () => {
    const paths = gitReadWritePaths(scope);
    expect(paths).toContain("/wt");
    expect(paths).toContain(join("/main", ".git", "worktrees", "wt-1"));
    expect(paths).toContain(join("/main", ".git", "objects"));
    expect(ownRefPaths("/main/.git", "feature/x")).toEqual({
      ref: join("/main", ".git", "refs", "heads", "feature/x"),
      reflog: join("/main", ".git", "logs", "refs", "heads", "feature/x"),
    });
    expect(paths).toContain(join("/main", ".git", "refs", "heads", "feature/x"));
    expect(paths).toContain(join("/main", ".git", "refs", "remotes"));
  });

  it("allows fetch paths and lock siblings", () => {
    const git = "/main/.git";
    expect(classifySharedGitWrite(join(git, "refs", "remotes", "origin", "main"), scope)).toBe("allow");
    expect(classifySharedGitWrite(join(git, "logs", "refs", "remotes", "origin", "main"), scope)).toBe(
      "allow",
    );
    expect(classifySharedGitWrite(join(git, "refs", "heads", "feature/x.lock"), scope)).toBe("allow");
    expect(classifySharedGitWrite(join(git, "objects", "ab", "cdef"), scope)).toBe("allow");
    expect(classifySharedGitWrite(join("/wt", "src", "a.ts"), scope)).toBe("allow");
    expect(classifySharedGitWrite(join("/main", ".git", "worktrees", "wt-1", "index"), scope)).toBe("allow");
  });

  it("denies shared HEAD, config, hooks, info, other refs and top-level state", () => {
    const git = "/main/.git";
    const denied = [
      join(git, "HEAD"),
      join(git, "config"),
      join(git, "hooks", "pre-commit"),
      join(git, "info", "exclude"),
      join(git, "refs", "heads", "main"),
      join(git, "logs", "refs", "heads", "main"),
      join(git, "index"),
      join(git, "logs", "HEAD"),
      join(git, "packed-refs"),
      join(git, "worktrees", "wt-2", "index"),
      "/main/src/a.ts",
      "/elsewhere/x",
    ];
    for (const path of denied) {
      expect(classifySharedGitWrite(path, scope), path).toBe("deny");
    }
  });
});

const haveGit = () =>
  run("git", ["--version"])
    .then(() => true)
    .catch(() => false);

const scratchDirs: string[] = [];
afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const git = (cwd: string, args: string[]) =>
  run("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd });

async function listFiles(root: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) found.set(path, await readFile(path, "utf8").catch(() => ""));
    }
  };
  await walk(root);
  return found;
}

/**
 * Positive test FIRST: a worktree commit succeeds and touches only allowlisted
 * paths (the spike-77216 snapshot method). The negative test below then shows
 * the main checkout's paths classify as denied.
 */
describe("real git worktree commits", () => {
  it("a worktree add+commit writes only allowlisted paths", async () => {
    if (!(await haveGit())) return;
    const main = await mkdtemp(join(tmpdir(), "pi-git-main-"));
    scratchDirs.push(main);
    await git(main, ["init", "-b", "main"]);
    await run("git", ["config", "user.email", "t@t"], { cwd: main });
    await run("git", ["config", "user.name", "t"], { cwd: main });
    await import("node:fs/promises").then((fs) => fs.writeFile(join(main, "a.txt"), "a\n"));
    await git(main, ["add", "a.txt"]);
    await git(main, ["commit", "-m", "base"]);
    const wtParent = await mkdtemp(join(tmpdir(), "pi-git-wt-"));
    scratchDirs.push(wtParent);
    const worktree = join(wtParent, "wt-1");
    await git(main, ["worktree", "add", "-b", "feature/x", worktree]);
    const scope = scopeFor(main, worktree, "feature/x");
    expect((await stat(scope.adminDir)).isDirectory()).toBe(true);

    const before = await listFiles(scope.sharedGitDir);
    await import("node:fs/promises").then((fs) => fs.writeFile(join(worktree, "b.txt"), "b\n"));
    await git(worktree, ["add", "b.txt"]);
    await git(worktree, ["commit", "-m", "work"]);
    const after = await listFiles(scope.sharedGitDir);

    // The commit itself succeeded (positive gate for the negative test below).
    const log = await git(worktree, ["log", "--oneline", "-1"]);
    expect(log.stdout).toContain("work");

    const touched: string[] = [];
    for (const [path, content] of after) {
      if (before.get(path) !== content) touched.push(path);
    }
    // Nothing left behind as a lockfile.
    expect(touched.filter((path) => path.endsWith(".lock"))).toEqual([]);
    expect(touched.length).toBeGreaterThan(0);
    for (const path of touched) {
      expect(classifySharedGitWrite(path, scope), path).toBe("allow");
    }
  });

  it("the main checkout's own commit paths classify as denied for the thread", async () => {
    if (!(await haveGit())) return;
    const main = await mkdtemp(join(tmpdir(), "pi-git-neg-"));
    scratchDirs.push(main);
    await git(main, ["init", "-b", "main"]);
    const scope = scopeFor(main, join(main, "..", "wt-1"), "feature/x");
    // The main branch ref, its reflog and the main checkout itself are all
    // outside the thread's allowlist: a `git -C <main> commit` cannot land there.
    expect(classifySharedGitWrite(join(main, ".git", "refs", "heads", "main"), scope)).toBe("deny");
    expect(classifySharedGitWrite(join(main, ".git", "logs", "refs", "heads", "main"), scope)).toBe("deny");
    expect(classifySharedGitWrite(join(main, "a.txt"), scope)).toBe("deny");
  });
});
