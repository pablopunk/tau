import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertWriteAllowed, openConfinedWrite, resolveWriteTarget, SandboxDenied } from "./sandbox-path";

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
});
