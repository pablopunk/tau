import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { afterEach, describe, expect, it } from "vitest";
import { createTauCodingTools } from "./coding-tools";
import { SandboxDenied } from "./tools/sandbox-path";
import { createToolServicesRef, type ToolServices } from "./tools/tool-file";

let directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  directories = [];
});

async function scratch(): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "tau-coding-tools-")));
  directories.push(directory);
  return directory;
}

interface Fixture {
  readonly root: string;
  readonly outside: string;
  readonly write: (path: string, content: string) => Promise<unknown>;
  readonly edit: (path: string, oldText: string, newText: string) => Promise<unknown>;
}

async function fixture(sandbox: "on" | "off" | "unresolvable-root"): Promise<Fixture> {
  const root = await scratch();
  const outside = await scratch();
  const services = createToolServicesRef();
  services.set({
    sandbox: {
      scopeOf: async () => (sandbox === "off" ? undefined : ({ kind: "worktree" } as never)),
      rootOf: async () => (sandbox === "unresolvable-root" ? undefined : root),
      mcpAllowed: async () => true,
    },
  } as unknown as ToolServices);
  const tools = createTauCodingTools(undefined, services).tools as readonly ToolRegistration[];
  const run = (name: string, args: unknown) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const api = { conversationId: "thread-1", env: new NodeExecutionEnv({ cwd: root }) };
    return (tool.execute as (a: unknown, b: unknown, c: unknown) => Promise<unknown>)(
      args,
      api,
      {} as Context,
    );
  };
  return {
    root,
    outside,
    write: (path, content) => run("write", { path, content }),
    edit: (path, oldText, newText) => run("edit", { path, edits: [{ oldText, newText }] }),
  };
}

describe("coding-tools write and edit with the sandbox on", () => {
  it("writes inside the root", async () => {
    const { root, write } = await fixture("on");
    await write("notes.txt", "hello");
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("hello");
  });

  it("writes a new nested path inside the root", async () => {
    const { root, write } = await fixture("on");
    await write("newdir/sub/x.txt", "deep");
    expect(await readFile(join(root, "newdir", "sub", "x.txt"), "utf8")).toBe("deep");
  });

  it("overwrites a longer existing file completely", async () => {
    const { root, write } = await fixture("on");
    await writeFile(join(root, "a.txt"), "a much longer original");
    await write("a.txt", "short");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("short");
  });

  it("denies a write through a symlinked parent and leaves nothing behind", async () => {
    const { root, outside, write } = await fixture("on");
    await symlink(outside, join(root, "evil"));
    await expect(write("evil/leak.txt", "x")).rejects.toBeInstanceOf(SandboxDenied);
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(root)).toEqual(["evil"]);
  });

  it("denies a write outside the root by absolute path and creates nothing", async () => {
    const { outside, write } = await fixture("on");
    await expect(write(join(outside, "x.txt"), "x")).rejects.toBeInstanceOf(SandboxDenied);
    expect(await readdir(outside)).toEqual([]);
  });

  it("denies a write to a final-component symlink and keeps the target", async () => {
    const { root, outside, write } = await fixture("on");
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(join(outside, "secret.txt"), join(root, "link.txt"));
    await expect(write("link.txt", "overwritten")).rejects.toBeInstanceOf(SandboxDenied);
    expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("secret");
  });

  it("edits a file inside the root", async () => {
    const { root, edit } = await fixture("on");
    await writeFile(join(root, "a.txt"), "one two three");
    await edit("a.txt", "two", "2");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("one 2 three");
  });

  it("denies an edit through a symlinked parent and keeps the outside file", async () => {
    const { root, outside, edit } = await fixture("on");
    await writeFile(join(outside, "a.txt"), "one two three");
    await symlink(outside, join(root, "evil"));
    await expect(edit("evil/a.txt", "two", "2")).rejects.toBeInstanceOf(SandboxDenied);
    expect(await readFile(join(outside, "a.txt"), "utf8")).toBe("one two three");
  });

  it("leaves no empty file after editing a missing file", async () => {
    const { root, edit } = await fixture("on");
    await expect(edit("missing.txt", "a", "b")).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  });

  it("fails closed when the sandbox root is unresolvable", async () => {
    const { root, write } = await fixture("unresolvable-root");
    await expect(write("x.txt", "x")).rejects.toBeInstanceOf(SandboxDenied);
    expect(await readdir(root)).toEqual([]);
  });
});

describe("coding-tools write and edit with the sandbox off", () => {
  it("writes through a symlinked parent exactly as before", async () => {
    const { root, outside, write } = await fixture("off");
    await symlink(outside, join(root, "link"));
    await write("link/x.txt", "free");
    expect(await readFile(join(outside, "x.txt"), "utf8")).toBe("free");
  });

  it("creates nested parent directories", async () => {
    const { root, write } = await fixture("off");
    await write("a/b/c.txt", "ok");
    expect(await readFile(join(root, "a", "b", "c.txt"), "utf8")).toBe("ok");
  });

  it("edits a file", async () => {
    const { root, edit } = await fixture("off");
    await mkdir(join(root, "d"));
    await writeFile(join(root, "d", "a.txt"), "one two");
    await edit("d/a.txt", "two", "2");
    expect(await readFile(join(root, "d", "a.txt"), "utf8")).toBe("one 2");
  });
});
