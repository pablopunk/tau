import { mkdirSync, mkdtempSync, realpathSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compiled,
  definedVersion,
  installRootOf,
  type RuntimeProbe,
  stableBinary,
  stableBinaryOf,
  versionDir,
  versionDirOf,
} from "./install-paths";

const BUNFS = "file:///$bunfs/root/tau";
const probeOf = (execPath: string, over: Partial<RuntimeProbe> = {}): RuntimeProbe => ({
  execPath,
  metaUrl: BUNFS,
  bunMain: "/$bunfs/root/tau",
  ...over,
});

/** `<root>/versions/0.5.0/tau` with `current -> versions/0.5.0`, as install.sh lays it out. */
function installLayout() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tau-paths-")));
  mkdirSync(join(root, "versions", "0.5.0"), { recursive: true });
  writeFileSync(join(root, "versions", "0.5.0", "tau"), "");
  symlinkSync(join("versions", "0.5.0"), join(root, "current"));
  return root;
}

describe("compiled", () => {
  it("is true when the module URL or Bun.main is inside $bunfs", () => {
    expect(compiled(probeOf("/x/tau"))).toBe(true);
    expect(compiled(probeOf("/x/tau", { metaUrl: "file:///dev/bin.js" }))).toBe(true);
    expect(compiled(probeOf("/x/tau", { bunMain: undefined }))).toBe(true);
  });

  it("is false from a dev checkout or the Node build", () => {
    expect(compiled(probeOf("/n/node", { metaUrl: "file:///repo/dist/bin.js", bunMain: undefined }))).toBe(
      false,
    );
    expect(
      compiled(probeOf("/b/bun", { metaUrl: "file:///repo/src/x.ts", bunMain: "/repo/src/bin.ts" })),
    ).toBe(false);
  });
});

describe("paths of an installed binary", () => {
  it("strips versions/<v>/tau to the install root", () => {
    expect(installRootOf("/r/versions/0.5.0/tau")).toBe("/r");
    expect(installRootOf("/opt/tau")).toBeUndefined();
  });

  it("uses <root>/current/tau as the stable binary and the version folder for assets", () => {
    expect(stableBinaryOf("/r/versions/0.5.0/tau")).toBe("/r/current/tau");
    expect(versionDirOf("/r/versions/0.5.0/tau")).toBe("/r/versions/0.5.0");
  });

  it("a hand-placed binary is its own stable path", () => {
    expect(stableBinaryOf("/opt/tau/tau")).toBe("/opt/tau/tau");
    expect(versionDirOf("/opt/tau/tau")).toBe("/opt/tau");
  });

  it("derives both paths from the real path whichever way it was started", () => {
    const root = installLayout();
    const bin = join(tmpdir(), `tau-bin-${process.pid}`);
    symlinkSync(join(root, "current", "tau"), bin);
    for (const started of [join(root, "versions", "0.5.0", "tau"), join(root, "current", "tau"), bin]) {
      // the OS reports execPath resolved (pin P8), so a symlink is never what the code sees
      const probe = probeOf(realpathSync(started));
      expect(stableBinary(probe)).toBe(join(root, "current", "tau"));
      expect(versionDir(probe)).toBe(join(root, "versions", "0.5.0"));
    }
  });

  it("keeps the old version dir for a running old server after a swap", () => {
    const root = installLayout();
    mkdirSync(join(root, "versions", "0.6.0"));
    writeFileSync(join(root, "versions", "0.6.0", "tau"), "");
    const running = probeOf(realpathSync(join(root, "current", "tau")));
    symlinkSync(join("versions", "0.6.0"), join(root, "current.tmp"));
    renameCurrent(root);
    expect(versionDir(running)).toBe(join(root, "versions", "0.5.0"));
    expect(stableBinary(running)).toBe(join(root, "current", "tau"));
  });

  it("refuses outside a compiled binary", () => {
    const dev = probeOf("/n/node", { metaUrl: "file:///repo/dist/bin.js", bunMain: undefined });
    expect(() => stableBinary(dev)).toThrow("compiled");
    expect(() => versionDir(dev)).toThrow("compiled");
  });
});

describe("definedVersion", () => {
  it("is undefined without the TAU_VERSION build define", () => {
    expect(definedVersion()).toBeUndefined();
  });
});

function renameCurrent(root: string): void {
  renameSync(join(root, "current.tmp"), join(root, "current"));
}
