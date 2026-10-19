import { describe, expect, it } from "vitest";
import { summary } from "../commands/test-support";
import { hasRunningWork, runningWorkOf } from "./running-work";

describe("runningWorkOf", () => {
  it("counts a running subagent once, as a subagent", () => {
    const all = [
      summary("a", { status: "running" }),
      summary("c", { status: "running", parentId: "a", agentStatus: "running" }),
    ];
    const work = runningWorkOf(all);
    expect(work.threads.map((t) => t.id)).toEqual(["a"]);
    expect(work.subagents.map((t) => t.id)).toEqual(["c"]);
  });
  it("skips archived threads and the caller's own lineage; timers and goals resume", () => {
    const all = [
      summary("p", { status: "running" }),
      summary("me", { status: "running", parentId: "p", agentStatus: "running" }),
      summary("old", { status: "running", archivedAt: 5 }),
      summary("t", { timers: 1 }),
      summary("g", { goal: { state: "active", condition: "x" } }),
    ];
    const work = runningWorkOf(all, "me");
    expect(hasRunningWork(work)).toBe(false);
    expect(work.resuming.map((t) => t.id)).toEqual(["t", "g"]);
  });
});
