import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { type ConversationSummary, ConversationSummarySchema } from "./entities";

const legacySummary: ConversationSummary = {
  id: "1",
  projectId: "p1",
  title: "t",
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  status: "idle",
  lastRunEndedAt: null,
  avatarIndex: 0,
  lastActivityAt: 1,
  model: null,
  workspace: {
    mode: "checkout",
    path: "/p",
    branch: null,
    base: null,
    state: "ready",
    mergedSha: null,
    pullRequestUrl: null,
  },
  forkOf: null,
  parentId: null,
  agentType: null,
  agentModel: null,
  agentStatus: null,
  background: false,
  agentThinking: null,
  timers: 0,
  nextTimerAt: null,
  goal: null,
  unmergedWarning: null,
};

describe("ConversationSummary executor", () => {
  it("accepts a summary without an executor", () => {
    expect(Value.Check(ConversationSummarySchema, legacySummary)).toBe(true);
  });

  it.each(["pi", "claude-code"])("accepts executor %s", (executor) => {
    expect(Value.Check(ConversationSummarySchema, { ...legacySummary, executor })).toBe(true);
  });

  it("rejects an unknown executor", () => {
    expect(Value.Check(ConversationSummarySchema, { ...legacySummary, executor: "bogus" })).toBe(false);
  });
});
