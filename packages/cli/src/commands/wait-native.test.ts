import { describe, expect, it } from "vitest";
import { CliExit } from "./cli-exit";
import { executeApiCommand } from "./run-command";
import {
  assistantTextEvent,
  FakeTau,
  lifecycleEvent,
  makeHome,
  nativeSummary,
  nativeViewWith,
  noticeEvent,
  summary,
  userEvent,
  viewWith,
} from "./test-support";
import { assessThread } from "./wait";

const completedRun = [
  userEvent("u1", "do it"),
  lifecycleEvent("l1", "accepted"),
  lifecycleEvent("l2", "running"),
  assistantTextEvent("a1", "working", "m1"),
  { type: "tool-call", key: "t1", callId: "c1", name: "bash", input: { command: "ls" } },
  { type: "tool-result", key: "t2", callId: "c1", isError: false, text: "file", imageCount: 0 },
  assistantTextEvent("a2", "all finished", "m2"),
  lifecycleEvent("l3", "completed"),
];

const assess = (
  events: Record<string, unknown>[],
  overrides = {},
  endedAfter: number | null | undefined = 10,
) =>
  assessThread(
    [nativeSummary("t1", { lastRunEndedAt: 20, ...overrides })],
    "t1",
    nativeViewWith(events),
    endedAfter,
  );

describe("assessThread for native threads", () => {
  it("is done with the final text of the last operation", () => {
    expect(assess(completedRun)).toEqual({ state: "done", answer: "all finished" });
  });

  it("answers from the last operation only", () => {
    const second = [...completedRun, userEvent("u2", "again"), lifecycleEvent("l4", "running")];
    expect(
      assess([...second, assistantTextEvent("a3", "second answer", "m3"), lifecycleEvent("l5", "completed")]),
    ).toEqual({
      state: "done",
      answer: "second answer",
    });
  });

  it("waits while running, or before a run ended after R0", () => {
    expect(assess([...completedRun.slice(0, 4)]).state).toBe("waiting");
    expect(assess(completedRun, {}, 20).state).toBe("waiting");
    expect(assess(completedRun, { status: "running" }).state).toBe("waiting");
  });

  it("waits for a running child", () => {
    const all = [
      nativeSummary("t1", { lastRunEndedAt: 20 }),
      summary("c1", { parentId: "t1", agentStatus: "running" }),
    ];
    expect(assessThread(all, "t1", nativeViewWith(completedRun), 10).state).toBe("waiting");
  });

  it("never treats a native view without lifecycle events as done", () => {
    expect(assess([]).state).toBe("error");
    expect(assess([userEvent("u1", "hi")], { lastRunEndedAt: null }).state).toBe("waiting");
    expect(assess([], { status: "running" }).state).toBe("waiting");
  });

  it("reports an unknown outcome as an error without an answer", () => {
    const result = assess([...completedRun.slice(0, 7), lifecycleEvent("l3", "outcome-unknown")]);
    expect(result).toEqual({
      state: "error",
      message: "the run's outcome is unknown; check the workspace",
    });
  });

  it("reports a blocked run with the latest notice", () => {
    const result = assess([
      ...completedRun.slice(0, 4),
      noticeEvent("n1", "Permission needed for Bash"),
      lifecycleEvent("l3", "blocked"),
    ]);
    expect(result).toEqual({ state: "error", message: "the run is blocked: Permission needed for Bash" });
  });

  it("reports a failed run with the error result", () => {
    const result = assess(
      [
        ...completedRun.slice(0, 4),
        {
          type: "result",
          key: "r1",
          subtype: "error_max_turns",
          isError: true,
          text: "too many turns",
          sessionId: "s",
        },
        lifecycleEvent("l3", "failed"),
      ],
      { status: "error" },
    );
    expect(result).toEqual({ state: "error", message: "too many turns" });
  });

  it("reports cancelled and interrupted runs as errors", () => {
    expect(assess([...completedRun.slice(0, 4), lifecycleEvent("l3", "cancelled")])).toEqual({
      state: "error",
      message: "the run was cancelled",
    });
    expect(assess([...completedRun.slice(0, 4), lifecycleEvent("l3", "interrupted")]).state).toBe("error");
  });

  it("keeps the Pi path for a summary without an executor", () => {
    const all = [summary("t1", { lastRunEndedAt: 20 })];
    expect(assessThread(all, "t1", viewWith("pi answer"), 10)).toEqual({
      state: "done",
      answer: "pi answer",
    });
  });

  it("refuses to read native entries as Pi", () => {
    const all = [summary("t1", { lastRunEndedAt: 20 })];
    expect(() => assessThread(all, "t1", nativeViewWith(completedRun), 10)).toThrow(/names no executor/);
  });
});

describe("tau threads wait for native threads", () => {
  function setup(events: Record<string, unknown>[], overrides = {}) {
    const fake = new FakeTau();
    fake.summaries = [nativeSummary("t1", { lastRunEndedAt: 5, ...overrides })];
    fake.views.set("t1", nativeViewWith(events));
    return { fake, env: fake.env(makeHome()) };
  }

  it("prints the final answer and exits 0 when done", async () => {
    const { fake, env } = setup(completedRun);
    await executeApiCommand("threads", ["wait", "t1"], env);
    expect(fake.stdout).toEqual(["all finished"]);
  });

  it("exits non-zero on an unknown outcome and prints no answer", async () => {
    const { fake, env } = setup([...completedRun.slice(0, 7), lifecycleEvent("l3", "outcome-unknown")]);
    const error = await executeApiCommand("threads", ["wait", "t1"], env).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CliExit);
    expect((error as CliExit).exitCode).toBe(1);
    expect((error as CliExit).message).toBe("the run's outcome is unknown; check the workspace");
    expect(fake.stdout).toEqual([]);
  });

  it("keeps waiting while the run is pending, then finishes on the next frame", async () => {
    const { fake, env } = setup(completedRun.slice(0, 4), { status: "running" });
    const done = executeApiCommand("threads", ["wait", "t1"], env);
    await fake.quiet();
    expect(fake.stdout).toEqual([]);
    fake.summaries = [nativeSummary("t1", { lastRunEndedAt: 20 })];
    fake.pushView("t1", nativeViewWith(completedRun));
    await done;
    expect(fake.stdout).toEqual(["all finished"]);
  });

  it("exits 3 on timeout while pending", async () => {
    const { env } = setup(completedRun.slice(0, 4), { status: "running" });
    const error = await executeApiCommand("threads", ["wait", "t1", "--timeout", "0.05"], env).catch(
      (caught: unknown) => caught,
    );
    expect((error as CliExit).exitCode).toBe(3);
  });
});
