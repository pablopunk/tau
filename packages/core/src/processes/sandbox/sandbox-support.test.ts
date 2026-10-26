import { describe, expect, it } from "vitest";
import { probeSandboxSupport } from "./sandbox-support";

describe("probeSandboxSupport", () => {
  it("enforces on macOS only with sandbox-exec present", () => {
    expect(probeSandboxSupport("macos", { sandboxExec: "/usr/bin/sandbox-exec" })).toMatchObject({
      enforced: true,
      note: null,
    });
    const missing = probeSandboxSupport("macos", {});
    expect(missing.enforced).toBe(false);
    expect(missing.note).toMatch(/unenforced/);
  });

  it("enforces on Linux with systemd-run or bwrap", () => {
    expect(probeSandboxSupport("linux", { systemdRun: "/usr/bin/systemd-run" }).enforced).toBe(true);
    expect(probeSandboxSupport("linux", { bwrap: "/usr/bin/bwrap" }).enforced).toBe(true);
    const neither = probeSandboxSupport("linux", {});
    expect(neither.enforced).toBe(false);
    expect(neither.note).toMatch(/unenforced/);
  });

  it("is explicitly unenforced elsewhere, never silent", () => {
    const other = probeSandboxSupport("other", {});
    expect(other.enforced).toBe(false);
    expect(other.note).toMatch(/unenforced/);
  });
});
