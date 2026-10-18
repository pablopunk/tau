import type { Goal } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { formatElapsed, goalStatusFields, parseGoalArgs } from "./goal-status";

describe("parseGoalArgs", () => {
  it("shows the status without arguments", () => {
    expect(parseGoalArgs("")).toEqual({ kind: "status" });
    expect(parseGoalArgs("   ")).toEqual({ kind: "status" });
  });

  it.each(["clear", "stop", "off", "reset", "none", "cancel", "CLEAR"])("%s clears", (word) => {
    expect(parseGoalArgs(word)).toEqual({ kind: "clear" });
  });

  it("sets anything else, also when it starts with a clear word", () => {
    expect(parseGoalArgs("all tests pass")).toEqual({ kind: "set", condition: "all tests pass" });
    expect(parseGoalArgs("stop after 20 turns")).toEqual({ kind: "set", condition: "stop after 20 turns" });
  });
});

describe("goalStatusFields", () => {
  const goal: Goal = {
    id: "g",
    condition: "tests pass",
    state: "active",
    startedAt: 0,
    turnsEvaluated: 3,
    tokensSpent: 12_500,
    lastVerdict: "not_met",
    lastReason: "one test fails",
  };

  it("lists the condition, elapsed time, turns, tokens and last reason", () => {
    expect(Object.fromEntries(goalStatusFields(goal, 90 * 60_000).map((f) => [f.label, f.value]))).toEqual({
      Condition: "tests pass",
      State: "active",
      Elapsed: "1h 30m",
      "Turns evaluated": "3",
      Tokens: "12.5k",
      "Last reason": "one test fails",
    });
  });

  it("formats short durations", () => {
    expect(formatElapsed(5000)).toBe("5s");
    expect(formatElapsed(5 * 60_000)).toBe("5m");
  });
});
