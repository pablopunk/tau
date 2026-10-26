import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertWriteAllowed,
  confinedWriteFile,
  openConfinedWrite,
  resolveWriteTarget,
  SandboxDenied,
} from "./sandbox-path";

let roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots = [];
});

async function scratch(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "tau-sandbox-path-")));
  roots.push(root);
  return root;
}

const denied = (promise: Promise<unknown>) =>
  promise.then(
    () => "allowed",
    (error: unknown) => (error instanceof SandboxDenied ? "denied" : `unexpected: ${String(error)}`),
  );

describe("sandbox-path", () => {
  it("allows a write inside the root", async () => {
    const root = await scratch();
    const { handle, resolved } = await openConfinedWrite("notes.txt", root, root);
    await handle.writeFile("hello");
    await handle.close();
    expect(resolved).toBe(join(root, "notes.txt"));
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("hello");
  });

  it("denies an absolute path outside the root", async () => {
    const root = await scratch();
    expect(await denied(assertWriteAllowed("/etc/hostname", root))).toBe("denied");
  });

  it("denies a `..` escape through a relative path", async () => {
    const root = await scratch();
    expect(await denied(assertWriteAllowed("../escape.txt", root, root))).toBe("denied");
  });

  it("denies when the final component is a symlink", async () => {
    const root = await scratch();
    const outside = join(tmpdir(), `tau-sandbox-outside-${Date.now()}.txt`);
    await writeFile(outside, "secret");
    roots.push(outside);
    await symlink(outside, join(root, "link.txt"));
    expect(await denied(assertWriteAllowed(join(root, "link.txt"), root))).toBe("denied");
  });

  it("denies when a symlinked parent points outside the root", async () => {
    const root = await scratch();
    const outside = await realpath(await mkdtemp(join(tmpdir(), "tau-sandbox-out-")));
    roots.push(outside);
    await symlink(outside, join(root, "evildir"));
    expect(await denied(assertWriteAllowed(join(root, "evildir", "x.txt"), root))).toBe("denied");
  });

  it("denies when the root itself does not resolve", async () => {
    expect(await denied(assertWriteAllowed("x.txt", join(tmpdir(), "tau-no-such-root")))).toBe("denied");
  });

  it("denies when the target parent cannot be resolved", async () => {
    const root = await scratch();
    expect(await denied(assertWriteAllowed(join("no-such-dir", "x.txt"), root, root))).toBe("denied");
  });

  it("resolves a nested path to its canonical location", async () => {
    const root = await scratch();
    await mkdir(join(root, "sub"), { recursive: true });
    const { resolved } = await resolveWriteTarget("sub/x.txt", root, root);
    expect(resolved).toBe(join(root, "sub", "x.txt"));
  });

  it("assertWriteAllowed through a symlinked parent creates nothing outside the root", async () => {
    const root = await scratch();
    const outside = await scratch();
    await symlink(outside, join(root, "evil"));
    expect(await denied(assertWriteAllowed(join(root, "evil", "leak.txt"), root))).toBe("denied");
    expect(await readdir(outside)).toEqual([]);
  });
});

describe("confinedWriteFile", () => {
  it("writes a file inside the root", async () => {
    const root = await scratch();
    await confinedWriteFile("notes.txt", "hello", root, root);
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("hello");
  });

  it("truncates a longer existing file", async () => {
    const root = await scratch();
    await writeFile(join(root, "a.txt"), "long long content");
    await confinedWriteFile("a.txt", "short", root, root);
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("short");
  });

  it("creates missing parent directories inside the root", async () => {
    const root = await scratch();
    await confinedWriteFile("newdir/sub/x.txt", "deep", root, root);
    expect(await readFile(join(root, "newdir", "sub", "x.txt"), "utf8")).toBe("deep");
  });

  it("denies a symlinked parent and creates nothing outside", async () => {
    const root = await scratch();
    const outside = await scratch();
    await symlink(outside, join(root, "evil"));
    expect(await denied(confinedWriteFile("evil/leak.txt", "x", root, root))).toBe("denied");
    expect(await readdir(outside)).toEqual([]);
  });

  it("denies a new nested path under a symlinked parent and creates nothing outside", async () => {
    const root = await scratch();
    const outside = await scratch();
    await symlink(outside, join(root, "evil"));
    expect(await denied(confinedWriteFile("evil/new/sub/leak.txt", "x", root, root))).toBe("denied");
    expect(await readdir(outside)).toEqual([]);
  });

  it("denies a dangling symlinked parent and creates nothing outside", async () => {
    const root = await scratch();
    const outside = await scratch();
    await symlink(join(outside, "not-yet"), join(root, "evil"));
    expect(await denied(confinedWriteFile("evil/leak.txt", "x", root, root))).toBe("denied");
    expect(await readdir(outside)).toEqual([]);
  });

  it("denies an absolute path outside the root and creates nothing", async () => {
    const root = await scratch();
    const outside = await scratch();
    expect(await denied(confinedWriteFile(join(outside, "x.txt"), "x", root, root))).toBe("denied");
    expect(await readdir(outside)).toEqual([]);
  });

  it("denies a final-component symlink and leaves its target untouched", async () => {
    const root = await scratch();
    const outside = await scratch();
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(join(outside, "secret.txt"), join(root, "link.txt"));
    expect(await denied(confinedWriteFile("link.txt", "overwritten", root, root))).toBe("denied");
    expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("secret");
  });

  it("denies a dangling final-component symlink and creates nothing", async () => {
    const root = await scratch();
    const outside = await scratch();
    await symlink(join(outside, "ghost.txt"), join(root, "link.txt"));
    expect(await denied(confinedWriteFile("link.txt", "x", root, root))).toBe("denied");
    expect(await readdir(outside)).toEqual([]);
  });

  it("leaves no empty file inside the root after a denied write", async () => {
    const root = await scratch();
    const outside = await scratch();
    await symlink(outside, join(root, "evil"));
    await denied(confinedWriteFile("evil/leak.txt", "x", root, root));
    expect(await readdir(root)).toEqual(["evil"]);
  });

  it("does not follow a parent swapped to an outside symlink after validation", async () => {
    const root = await scratch();
    const outside = await scratch();
    await mkdir(join(root, "dir"));
    const swapParentForOutsideSymlink = async () => {
      await rename(join(root, "dir"), join(root, "dir-moved"));
      await symlink(outside, join(root, "dir"));
    };
    const result = await denied(
      confinedWriteFile("dir/x.txt", "x", root, root, { beforeOpen: swapParentForOutsideSymlink }),
    );
    expect(result).toBe("denied");
    expect(await readdir(outside)).toEqual([]);
  });

  it("leaves an existing outside file untouched when its parent is swapped after validation", async () => {
    const root = await scratch();
    const outside = await scratch();
    await writeFile(join(outside, "x.txt"), "keep me");
    await mkdir(join(root, "dir"));
    await writeFile(join(root, "dir", "x.txt"), "inside");
    const swapParentForOutsideSymlink = async () => {
      await rename(join(root, "dir"), join(root, "dir-moved"));
      await symlink(outside, join(root, "dir"));
    };
    await denied(
      confinedWriteFile("dir/x.txt", "new", root, root, { beforeOpen: swapParentForOutsideSymlink }),
    );
    expect(await readFile(join(outside, "x.txt"), "utf8")).toBe("keep me");
    expect((await lstat(join(root, "dir"))).isSymbolicLink()).toBe(true);
  });

  it("denies when the root itself does not resolve", async () => {
    expect(await denied(confinedWriteFile("x.txt", "x", join(tmpdir(), "tau-no-such-root")))).toBe("denied");
  });
});
