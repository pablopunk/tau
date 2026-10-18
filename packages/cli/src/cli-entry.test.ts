import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cliEntry } from "./cli-entry";
import { cliVersion } from "./version";

describe("cliEntry", () => {
  it("gives the node path and the symlink-free entry path", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "tau-entry-")));
    writeFileSync(join(dir, "bin.js"), "");
    symlinkSync(join(dir, "bin.js"), join(dir, "tau"));
    expect(cliEntry(["node", join(dir, "tau")], "/n/node")).toEqual({
      node: "/n/node",
      entry: join(dir, "bin.js"),
    });
  });

  it("refuses when nothing started tau", () => {
    expect(() => cliEntry(["node"], "/n/node")).toThrow("Cannot tell");
  });
});

describe("cliVersion", () => {
  it("reads the package version", () => {
    expect(cliVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
