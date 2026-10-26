import { describe, expect, it } from "vitest";
import {
  buildReport,
  type CheckResult,
  type CheckStatus,
  EXIT_FAILED,
  EXIT_PASSED,
  EXIT_UNSUPPORTED,
  enforcementPathOf,
  exitCodeOf,
  fail,
  judgeWrite,
  parseProbeLines,
  pass,
  runCheck,
  scopeMatrixRow,
  summaryTable,
  unsupported,
  verdictFailures,
} from "./boundary-checks";

const resultOf = (name: string, status: CheckStatus, required = true): CheckResult => ({
  name,
  status,
  required,
  reason: `${name} ${status}`,
  elapsedMs: 1,
});

const reportOf = (results: CheckResult[], requireSupported = false) =>
  buildReport({
    generatedAt: "2026-01-01T00:00:00.000Z",
    platform: { os: "darwin", arch: "arm64", node: "v22" },
    enforcementPath: "sandbox-exec",
    binaries: { sandboxExec: "/usr/bin/sandbox-exec" },
    requestedPolicy: { scope: "subagent" },
    results,
    limits: ["a limit"],
    requireSupported,
    leftoverProcesses: [],
  });

describe("exitCodeOf", () => {
  it("is 0 when every check passed", () => {
    expect(exitCodeOf([resultOf("a", "PASS"), resultOf("b", "PASS")], true)).toBe(EXIT_PASSED);
  });

  it("is 1 for any failed assertion, even with --require-supported and unsupported checks", () => {
    const results = [resultOf("a", "FAIL"), resultOf("b", "UNSUPPORTED")];
    expect(exitCodeOf(results, false)).toBe(EXIT_FAILED);
    expect(exitCodeOf(results, true)).toBe(EXIT_FAILED);
  });

  it("is 2 for a required UNSUPPORTED check under --require-supported", () => {
    expect(exitCodeOf([resultOf("a", "PASS"), resultOf("b", "UNSUPPORTED")], true)).toBe(EXIT_UNSUPPORTED);
  });

  it("is 0 for a required UNSUPPORTED check without --require-supported", () => {
    expect(exitCodeOf([resultOf("b", "UNSUPPORTED")], false)).toBe(EXIT_PASSED);
  });

  it("ignores UNSUPPORTED on an informational check", () => {
    expect(exitCodeOf([resultOf("a", "PASS"), resultOf("p", "UNSUPPORTED", false)], true)).toBe(EXIT_PASSED);
  });
});

describe("buildReport", () => {
  const report = reportOf(
    [resultOf("a", "PASS"), resultOf("b", "UNSUPPORTED"), resultOf("c", "PASS", false)],
    true,
  );

  it("carries the plan's JSON shape", () => {
    expect(Object.keys(report).sort()).toEqual(
      [
        "binaries",
        "checks",
        "enforcementPath",
        "exitCode",
        "generatedAt",
        "leftoverProcesses",
        "limits",
        "platform",
        "requestedPolicy",
        "requireSupported",
        "schema",
        "summary",
        "unsupported",
      ].sort(),
    );
  });

  it("counts statuses and lists unsupported reasons", () => {
    expect(report.summary).toEqual({ pass: 2, fail: 0, unsupported: 1 });
    expect(report.unsupported).toEqual([{ check: "b", required: true, reason: "b UNSUPPORTED" }]);
    expect(report.exitCode).toBe(EXIT_UNSUPPORTED);
  });

  it("survives a JSON round trip", () => {
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("renders a name to status table", () => {
    expect(summaryTable(report).split("\n")).toEqual(["a  PASS", "b  UNSUPPORTED", "c  PASS"]);
  });
});

describe("runCheck", () => {
  it("reports the outcome with name, required flag and elapsed time", async () => {
    const result = await runCheck({ name: "x", required: false, run: async () => pass("fine") }, 1000);
    expect(result).toMatchObject({ name: "x", required: false, status: "PASS", reason: "fine" });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("turns a throw into FAIL", async () => {
    const result = await runCheck(
      {
        name: "x",
        required: true,
        run: async () => {
          throw new Error("boom");
        },
      },
      1000,
    );
    expect(result).toMatchObject({ status: "FAIL", reason: "check threw: boom" });
  });

  it("turns a hang into FAIL after the timeout", async () => {
    const result = await runCheck({ name: "x", required: true, run: () => new Promise(() => {}) }, 30);
    expect(result).toMatchObject({ status: "FAIL", reason: "check threw: timed out after 30ms" });
  });

  it("keeps UNSUPPORTED distinct from FAIL", async () => {
    const result = await runCheck(
      { name: "x", required: true, run: async () => unsupported("no sandbox-exec") },
      1000,
    );
    expect(result.status).toBe("UNSUPPORTED");
    expect((await runCheck({ name: "y", required: true, run: async () => fail("bad") }, 1000)).status).toBe(
      "FAIL",
    );
  });
});

describe("enforcementPathOf", () => {
  it.each([
    [{ platform: "macos", binaries: { sandboxExec: "/usr/bin/sandbox-exec" } }, "sandbox-exec"],
    [{ platform: "macos", binaries: {} }, "none"],
    [
      { platform: "linux", binaries: { bwrap: "/usr/bin/bwrap", systemdRun: "/usr/bin/systemd-run" } },
      "bwrap",
    ],
    [{ platform: "linux", binaries: { systemdRun: "/usr/bin/systemd-run" } }, "systemd-unit"],
    [{ platform: "linux", binaries: {} }, "none"],
    [{ platform: "other", binaries: {} }, "none"],
  ] as const)("%j resolves to %s", (support, expected) => {
    expect(enforcementPathOf(support)).toBe(expected);
  });
});

describe("scopeMatrixRow", () => {
  it("resolves each scope from the supplied settings, unknown failing closed when any scope is on", () => {
    expect(scopeMatrixRow({ main: false, worktree: false, subagent: true })).toEqual({
      main: "plain",
      worktree: "plain",
      subagent: "sandbox",
      unknown: "sandbox",
    });
  });

  it("is all plain with the staging gate", () => {
    expect(Object.values(scopeMatrixRow({ main: false, worktree: false, subagent: false }))).toEqual([
      "plain",
      "plain",
      "plain",
      "plain",
    ]);
  });
});

describe("write probes", () => {
  const lines = parseProbeLines(
    [
      '{"label":"inside","ok":true}',
      '{"label":"outside","ok":false,"code":"EPERM"}',
      '{"label":"symlink","ok":false,"code":"ENOENT"}',
      "noise",
      '{"label":"home","ok":true}',
    ].join("\n"),
  );

  it("parses only well-formed probe lines", () => {
    expect(lines.map((line) => line.label)).toEqual(["inside", "outside", "symlink", "home"]);
  });

  it("accepts a write inside and a permission denial outside", () => {
    expect(judgeWrite("inside", "allowed", lines).holds).toBe(true);
    expect(judgeWrite("outside", "denied", lines).holds).toBe(true);
  });

  it("rejects a denial that is not a permission error", () => {
    expect(judgeWrite("symlink", "denied", lines)).toMatchObject({
      holds: false,
      observed: "denied (ENOENT)",
    });
  });

  it("rejects a write that succeeded where denial was expected, and a missing result", () => {
    expect(judgeWrite("home", "denied", lines)).toMatchObject({ holds: false, observed: "written" });
    expect(judgeWrite("absent", "allowed", lines)).toMatchObject({
      holds: false,
      observed: "no probe result",
    });
  });

  it("lists failures for the report", () => {
    const verdicts = [judgeWrite("inside", "allowed", lines), judgeWrite("home", "denied", lines)];
    expect(verdictFailures(verdicts)).toEqual(["home: expected denied, observed written"]);
  });
});
