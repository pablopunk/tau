import { describe, expect, it } from "vitest";
import type { IndexedConversation } from "./conversation-docs";
import { toSummary } from "./conversation-index";

const project = { id: "p1", path: "/work/p1" };

const entry = (overrides: Partial<IndexedConversation> = {}): IndexedConversation => ({
  conversationId: 1,
  title: "t",
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
});

describe("toSummary executor", () => {
  it("omits the executor key for a legacy entry", () => {
    const summary = toSummary(project, entry());
    expect("executor" in summary).toBe(false);
  });

  it("emits claude-code only for an explicit native marker", () => {
    expect(toSummary(project, { ...entry(), executor: "claude-code" }).executor).toBe("claude-code");
  });

  it("omits the executor key for an explicit pi marker", () => {
    expect("executor" in toSummary(project, { ...entry(), executor: "pi" })).toBe(false);
  });

  it("never derives native from a claude-cli model provider", () => {
    const model = { provider: "claude-cli", modelId: "claude-sonnet" };
    const summary = toSummary(project, entry({ model, agentModel: model }));
    expect("executor" in summary).toBe(false);
    expect(summary.model).toEqual(model);
  });
});
