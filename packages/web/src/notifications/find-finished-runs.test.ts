import { describe, expect, it } from "vitest";
import { conversation } from "@/sidebar/test-support";
import { findFinishedRuns } from "./find-finished-runs";

describe("findFinishedRuns", () => {
  it("ignores the first load and threads that were not known before", () => {
    const next = [conversation({ lastRunEndedAt: 10 })];
    expect(findFinishedRuns(undefined, next)).toEqual([]);
    expect(findFinishedRuns([], next)).toEqual([]);
  });

  it("returns threads whose lastRunEndedAt grew", () => {
    const before = [conversation({ lastRunEndedAt: 10 }), conversation({ id: "x", lastRunEndedAt: 5 })];
    const after = [conversation({ lastRunEndedAt: 20 }), conversation({ id: "x", lastRunEndedAt: 5 })];
    expect(findFinishedRuns(before, after).map((c) => c.id)).toEqual(["c1"]);
  });

  it("counts the first ended run of a known thread", () => {
    const after = [conversation({ lastRunEndedAt: 20 })];
    expect(findFinishedRuns([conversation()], after)).toHaveLength(1);
  });
});
