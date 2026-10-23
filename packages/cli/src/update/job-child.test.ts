import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createJobReporter, isUpdateChild } from "./job-child";
import { readJobFile, writeJobFile } from "./job-file";

const seed = () => {
  const home = mkdtempSync(join(tmpdir(), "tau-job-"));
  writeJobFile(home, {
    state: "installing",
    target: "1.1.0",
    from: "1.0.0",
    nonce: "abc",
    pid: null,
    startedAt: 1,
    error: null,
  });
  return home;
};

describe("job reporter", () => {
  it("writes its pid at startup and every step, keeping the rest", () => {
    const home = seed();
    const reporter = createJobReporter({ TAU_UPDATE_JOB: "abc" }, home, 777);
    expect(readJobFile(home)).toMatchObject({ state: "installing", pid: 777, nonce: "abc", from: "1.0.0" });
    reporter?.step("restarting");
    expect(readJobFile(home)?.state).toBe("restarting");
    reporter?.step("failed", "boom");
    expect(readJobFile(home)).toMatchObject({ state: "failed", error: "boom", pid: 777 });
  });

  it("does nothing without a matching nonce", () => {
    const home = seed();
    expect(createJobReporter({}, home, 1)).toBeUndefined();
    expect(createJobReporter({ TAU_UPDATE_JOB: "other" }, home, 1)).toBeUndefined();
    expect(readJobFile(home)?.pid).toBeNull();
  });

  it("removes its own launchd label last", async () => {
    const calls: unknown[][] = [];
    const reporter = createJobReporter(
      { TAU_UPDATE_JOB: "abc", TAU_UPDATE_LABEL: "tau-update-9" },
      seed(),
      5,
    );
    await reporter?.release(async (command, args) => {
      calls.push([command, args]);
      return { code: 0, stdout: "", stderr: "" };
    });
    expect(calls).toEqual([["launchctl", ["remove", "tau-update-9"]]]);
  });
});

describe("isUpdateChild", () => {
  it("needs the nonce and the recorded pid", () => {
    const home = seed();
    createJobReporter({ TAU_UPDATE_JOB: "abc" }, home, 777);
    expect(isUpdateChild({ TAU_UPDATE_JOB: "abc" }, home, 777)).toBe(true);
    expect(isUpdateChild({ TAU_UPDATE_JOB: "abc" }, home, 778)).toBe(false);
    expect(isUpdateChild({ TAU_UPDATE_JOB: "nope" }, home, 777)).toBe(false);
    expect(isUpdateChild({}, home, 777)).toBe(false);
  });
});
