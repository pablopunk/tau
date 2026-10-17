import { describe, expect, it } from "vitest";
import { conversationDot } from "./conversation-dot";
import { conversation } from "./test-support";

const ended = { lastRunEndedAt: Date.now() + 10_000 };

describe("conversationDot", () => {
  it("marks a finished parent run as unseen", () => {
    expect(conversationDot(conversation(ended), false)).toBe("unseen");
  });

  it("never marks a subagent child as unseen", () => {
    expect(conversationDot(conversation({ ...ended, parentId: "1" }), false)).toBeNull();
  });

  it("still shows a running child", () => {
    expect(conversationDot(conversation({ parentId: "1", status: "running" }), false)).toBe("running");
  });
});
