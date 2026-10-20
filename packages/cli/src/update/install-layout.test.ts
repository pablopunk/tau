import { existsSync, mkdirSync, mkdtempSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentVersionOf, pruneVersions, serverRecordOf, swapCurrent } from "./install-layout";

function layout(versions: string[]) {
  const root = mkdtempSync(join(tmpdir(), "tau-layout-"));
  for (const version of versions) mkdirSync(join(root, "versions", version), { recursive: true });
  return { root, home: mkdtempSync(join(tmpdir(), "tau-home-")) };
}

describe("swapCurrent", () => {
  it("replaces the symlink atomically and leaves no temp link", () => {
    const { root } = layout(["1.0.0", "1.1.0"]);
    symlinkSync(join("versions", "1.0.0"), join(root, "current"));
    swapCurrent(root, "1.1.0");
    expect(readlinkSync(join(root, "current"))).toBe(join("versions", "1.1.0"));
    expect(currentVersionOf(root)).toBe("1.1.0");
    expect(existsSync(join(root, `current.tmp-${process.pid}`))).toBe(false);
  });
  it("creates current when there is none", () => {
    const { root } = layout(["1.0.0"]);
    expect(currentVersionOf(root)).toBeUndefined();
    swapCurrent(root, "1.0.0");
    expect(currentVersionOf(root)).toBe("1.0.0");
  });
});

describe("pruneVersions", () => {
  it("keeps the new current, the previous one and the folder the running server uses", () => {
    const { root, home } = layout(["0.8.0", "0.9.0", "1.0.0", "1.1.0"]);
    writeFileSync(
      serverRecordOf(home),
      JSON.stringify({ pid: 1, versionDir: join(root, "versions", "0.9.0") }),
    );
    expect(pruneVersions(root, ["1.1.0", "1.0.0"], home)).toEqual(["0.8.0"]);
    expect(existsSync(join(root, "versions", "0.9.0"))).toBe(true);
    expect(existsSync(join(root, "versions", "0.8.0"))).toBe(false);
  });
  it("works without a server record and with an undefined previous", () => {
    const { root, home } = layout(["0.9.0", "1.1.0"]);
    expect(pruneVersions(root, ["1.1.0", undefined], home)).toEqual(["0.9.0"]);
  });
});
