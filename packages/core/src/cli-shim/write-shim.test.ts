import { execFileSync } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoreWith, defaultCoreDependencies } from "../create-core";
import { NO_UPDATE_OPTIONS } from "../test-support/update-options";
import { writeTauShim } from "./write-shim";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tau shim-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("writeTauShim", () => {
  it("writes an executable script that runs the cli entry with its arguments", async () => {
    const entry = join(root, "entry dir.mjs");
    await writeFile(entry, "console.log(process.argv.slice(2).join('|'))");
    const file = await writeTauShim(root, { command: process.execPath, args: [entry] });
    expect((await stat(file)).mode & 0o111).toBeTruthy();
    expect(execFileSync(file, ["a", "b c"]).toString().trim()).toBe("a|b c");
  });
});

describe("writeTauShim with a compiled binary", () => {
  it("runs the command with no arguments before the caller's", async () => {
    const binary = join(root, "tau bin");
    await writeFile(binary, '#!/bin/sh\necho "$#:$*"\n', { mode: 0o755 });
    const file = await writeTauShim(root, { command: binary, args: [] });
    expect(execFileSync(file, ["x", "y z"]).toString().trim()).toBe("2:x y z");
  });
});

describe("createCore shim", () => {
  it("is written by the lock holder and not by a second launch", async () => {
    const home = join(root, "home");
    const first = await createCoreWith(
      { home, faux: true, cliCommand: { command: "/n", args: ["/first.mjs"] }, ...NO_UPDATE_OPTIONS },
      defaultCoreDependencies(),
    );
    const shim = join(home, "bin", "tau");
    expect((await stat(shim)).isFile()).toBe(true);
    await expect(
      createCoreWith(
        { home, faux: true, cliCommand: { command: "/n", args: ["/second.mjs"] }, ...NO_UPDATE_OPTIONS },
        defaultCoreDependencies(),
      ),
    ).rejects.toThrow();
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(shim, "utf8")).toContain("/first.mjs");
    await first.close();
  });
});
