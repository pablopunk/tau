import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
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
      command: "/n/node",
      args: [join(dir, "bin.js")],
    });
  });

  it("is the stable binary with no arguments when compiled", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "tau-entry-")));
    mkdirSync(join(root, "versions", "1.0.0"), { recursive: true });
    writeFileSync(join(root, "versions", "1.0.0", "tau"), "");
    const probe = {
      execPath: join(root, "versions", "1.0.0", "tau"),
      metaUrl: "file:///$bunfs/root/tau",
      bunMain: undefined,
    };
    expect(cliEntry(["bun", "/$bunfs/root/tau"], probe.execPath, probe)).toEqual({
      command: join(root, "current", "tau"),
      args: [],
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
