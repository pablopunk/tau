import { describe, expect, it } from "vitest";
import { composeOuter, sandboxBackend, sandboxEnabled, sandboxPrefix } from "./wrap";

const ALL_ON = { main: true, worktree: true, subagent: true };
const ALL_OFF = { main: false, worktree: false, subagent: false };
const seatbelt = { platform: "macos" as const, binaries: { sandboxExec: "/usr/bin/sandbox-exec" } };
const systemd = { platform: "linux" as const, binaries: { systemdRun: "/usr/bin/systemd-run" } };

const input = {
  root: "/wt",
  scope: "worktree" as const,
  unit: "tau-abc-1",
  workingDirectory: "/wt",
};

describe("sandboxEnabled", () => {
  it("follows its own scope flag", () => {
    expect(sandboxEnabled(ALL_ON, "worktree")).toBe(true);
    expect(sandboxEnabled(ALL_OFF, "worktree")).toBe(false);
    expect(sandboxEnabled({ main: true, worktree: false, subagent: false }, "main")).toBe(true);
    expect(sandboxEnabled({ main: true, worktree: false, subagent: false }, "subagent")).toBe(false);
  });
});

describe("sandboxBackend", () => {
  it("picks seatbelt, systemd or bwrap, else null", () => {
    expect(sandboxBackend(seatbelt)).toBe("seatbelt");
    expect(sandboxBackend(systemd)).toBe("systemd");
    expect(sandboxBackend({ platform: "linux", binaries: {} })).toBeNull();
    expect(sandboxBackend({ platform: "other", binaries: {} })).toBeNull();
    expect(sandboxBackend({ platform: "linux", binaries: { bwrap: "/usr/bin/bwrap" } }, true)).toBe("bwrap");
    expect(sandboxBackend({ platform: "linux", binaries: { bwrap: "/usr/bin/bwrap" } })).toBeNull();
  });
});

describe("sandboxPrefix", () => {
  it("is null when the scope is off", () => {
    expect(sandboxPrefix({ ...input, settings: ALL_OFF, support: seatbelt })).toBeNull();
  });

  it("is null when unsupported, even with the switch on", () => {
    expect(
      sandboxPrefix({ ...input, settings: ALL_ON, support: { platform: "other", binaries: {} } }),
    ).toBeNull();
  });

  it("builds the seatbelt prefix carrying the root profile", () => {
    const prefix = sandboxPrefix({ ...input, settings: ALL_ON, support: seatbelt });
    expect(prefix?.file).toBe("/usr/bin/sandbox-exec");
    expect(prefix?.args[0]).toBe("-p");
    expect(prefix?.args[1]).toContain(`(subpath "/wt")`);
  });

  it("builds the systemd prefix ending in the inner-command separator", () => {
    const prefix = sandboxPrefix({ ...input, settings: ALL_ON, support: systemd });
    expect(prefix?.file).toBe("/usr/bin/systemd-run");
    expect(prefix?.args.at(-1)).toBe("--");
    expect(prefix?.args).toContain("--unit=tau-abc-1.service");
  });
});

describe("composeOuter", () => {
  it("nests sandbox OUTSIDE the governor wrap", () => {
    const sandbox = { file: "/usr/bin/systemd-run", args: ["--user", "--"] };
    const governor = { file: "/usr/bin/nice", args: ["-n", "5", "/bin/sh", "-c", "make"] };
    expect(composeOuter(sandbox, governor, "/bin/sh", "make")).toEqual({
      file: "/usr/bin/systemd-run",
      args: ["--user", "--", "/usr/bin/nice", "-n", "5", "/bin/sh", "-c", "make"],
    });
  });

  it("falls back to shell -c without a governor wrap", () => {
    const sandbox = { file: "/usr/bin/sandbox-exec", args: ["-p", "(profile)"] };
    expect(composeOuter(sandbox, null, "/bin/sh", "make")).toEqual({
      file: "/usr/bin/sandbox-exec",
      args: ["-p", "(profile)", "/bin/sh", "-c", "make"],
    });
  });
});
