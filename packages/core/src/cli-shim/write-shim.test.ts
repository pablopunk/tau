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
    const file = await writeTauShim(root, process.execPath, entry);
    expect((await stat(file)).mode & 0o111).toBeTruthy();
    expect(execFileSync(file, ["a", "b c"]).toString().trim()).toBe("a|b c");
  });
});

describe("createCore shim", () => {
  it("is written by the lock holder and not by a second launch", async () => {
    const home = join(root, "home");
    const first = await createCoreWith(
      { home, faux: true, cliEntry: "/first.mjs", ...NO_UPDATE_OPTIONS },
      defaultCoreDependencies(),
    );
    const shim = join(home, "bin", "tau");
    expect((await stat(shim)).isFile()).toBe(true);
    await expect(
      createCoreWith(
        { home, faux: true, cliEntry: "/second.mjs", ...NO_UPDATE_OPTIONS },
        defaultCoreDependencies(),
      ),
    ).rejects.toThrow();
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(shim, "utf8")).toContain("/first.mjs");
    await first.close();
  });
});
