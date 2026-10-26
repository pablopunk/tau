import { realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type FsSeam, isInsideRoot, resolveSandboxRoot } from "./trust-root";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const temp = async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-trust-"));
  dirs.push(dir);
  return dir;
};

describe("resolveSandboxRoot", () => {
  it("denies without trusted metadata: never substitutes cwd", async () => {
    const cwd = await temp();
    const resolved = resolveSandboxRoot(undefined);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.reason).not.toContain(cwd);
  });

  it("denies a removed worktree", () => {
    expect(resolveSandboxRoot({ kind: "removed", root: "/wt" }).ok).toBe(false);
  });

  it("denies a missing root", () => {
    expect(resolveSandboxRoot({ kind: "worktree" }).ok).toBe(false);
    expect(resolveSandboxRoot({ kind: "worktree", root: "  " }).ok).toBe(false);
    expect(resolveSandboxRoot({ kind: "worktree", root: "/nonexistent-root-xyz" }).ok).toBe(false);
  });

  it("denies a root that is not a directory", async () => {
    const dir = await temp();
    const file = join(dir, "f");
    await writeFile(file, "x");
    expect(resolveSandboxRoot({ kind: "worktree", root: file }).ok).toBe(false);
  });

  it("resolves a live worktree root canonically", async () => {
    const dir = await temp();
    // macOS resolves `/var` to `/private/var`: the canonical root is the contract.
    const canonical = realpathSync(dir);
    const resolved = resolveSandboxRoot({ kind: "worktree", root: `${dir}/` });
    expect(resolved).toEqual({ ok: true, root: canonical });
  });

  it("accepts checkout, main and non-git kinds with a live root", async () => {
    const dir = await temp();
    const canonical = realpathSync(dir);
    for (const kind of ["checkout", "main", "non-git"] as const) {
      expect(resolveSandboxRoot({ kind, root: dir })).toEqual({ ok: true, root: canonical });
    }
  });

  it("canonicalizes symlinks instead of trusting the spelling", async () => {
    const dir = await temp();
    const fs: FsSeam = {
      realpath: (path) => (path === "/link/wt" ? dir : path),
      isDirectory: () => true,
    };
    expect(resolveSandboxRoot({ kind: "worktree", root: "/link/wt" }, fs)).toEqual({
      ok: true,
      root: dir,
    });
  });
});

describe("isInsideRoot", () => {
  it("accepts the root itself and children, refuses siblings and escapes", async () => {
    const dir = await temp();
    const fs: FsSeam = { realpath: (path) => path, isDirectory: () => true };
    expect(isInsideRoot(dir, dir, fs)).toBe(true);
    expect(isInsideRoot(dir, join(dir, "a", "b"), fs)).toBe(true);
    expect(isInsideRoot(dir, `${dir}-other`, fs)).toBe(false);
    expect(isInsideRoot(dir, join(dir, "..", "outside"), fs)).toBe(false);
    expect(isInsideRoot(dir, "/nonexistent-xyz", fs)).toBe(false);
  });
});
