import { describe, expect, it } from "vitest";
import { agentInfoOf, contextUsageInputOf, imageRefsOf } from "./projection";
import type { ConversationView, EntryRecord } from "./view";

const viewOf = (entries: unknown[] = [], docs: Record<string, unknown> = {}) =>
  ({ entries, docs }) as unknown as ConversationView;

const screenshot = { type: "image", mimeType: "image/png", data: "aGVsbG8=" };

const user = (id: number, text: string) =>
  ({ id, kind: "pi.user", model: [{ role: "user", content: text }] }) as unknown as EntryRecord;

const assistant = (id: number, usage: object) =>
  ({
    id,
    kind: "pi.assistant",
    model: [{ role: "assistant", content: [], usage }],
  }) as unknown as EntryRecord;

const compaction = (id: number, head: number) =>
  ({ id, kind: "pi.compaction", head, model: [] }) as unknown as EntryRecord;

describe("agentInfoOf", () => {
  it("reads provider, model and thinking level from the pi.agent doc", () => {
    const view = viewOf([], {
      "pi.agent": { model: { provider: "anthropic", modelId: "opus" }, thinkingLevel: "high" },
    });
    expect(agentInfoOf(view)).toEqual({ provider: "anthropic", modelId: "opus", thinkingLevel: "high" });
  });

  it("defaults the thinking level to off when the doc has none", () => {
    const view = viewOf([], { "pi.agent": { model: { provider: "p", modelId: "m" } } });
    expect(agentInfoOf(view)).toEqual({ provider: "p", modelId: "m", thinkingLevel: "off" });
  });

  it("returns empty info when the doc is absent", () => {
    expect(agentInfoOf(viewOf())).toEqual({ provider: undefined, modelId: undefined, thinkingLevel: "off" });
  });
});

describe("contextUsageInputOf", () => {
  it("is undefined without any usage", () => {
    expect(contextUsageInputOf(viewOf([user(1, "hi")]))).toBeUndefined();
  });

  it("takes the totalTokens of the last answer", () => {
    const view = viewOf([user(1, "hi"), assistant(2, { totalTokens: 42_000 })]);
    expect(contextUsageInputOf(view)).toEqual({ usageTokens: 42_000, charsAfter: 0 });
  });

  it("sums the usage parts when totalTokens is 0", () => {
    const usage = { totalTokens: 0, input: 100, cacheRead: 20, cacheWrite: 30, output: 50 };
    expect(contextUsageInputOf(viewOf([assistant(1, usage)]))?.usageTokens).toBe(200);
  });

  it("counts the chars of messages after the last answer", () => {
    const view = viewOf([assistant(1, { totalTokens: 100 }), user(2, "x".repeat(38))]);
    expect(contextUsageInputOf(view)).toEqual({ usageTokens: 100, charsAfter: 40 });
  });

  it("ignores usage before the latest compaction head", () => {
    const view = viewOf([assistant(1, { totalTokens: 90_000 }), compaction(9, 3), user(3, "kept")]);
    expect(contextUsageInputOf(view)).toBeUndefined();
  });

  it("uses the kept answer after the compaction head", () => {
    const view = viewOf([
      compaction(9, 3),
      assistant(3, { totalTokens: 5_000 }),
      assistant(4, { totalTokens: 6_000 }),
    ]);
    expect(contextUsageInputOf(view)?.usageTokens).toBe(6_000);
  });

  it("does not mutate the view", () => {
    const view = viewOf([assistant(1, { totalTokens: 1 })]);
    const before = JSON.stringify(view);
    contextUsageInputOf(view);
    expect(JSON.stringify(view)).toBe(before);
  });
});

describe("imageRefsOf", () => {
  it("returns user images with the data url", () => {
    const view = viewOf([
      {
        id: 1,
        kind: "pi.user",
        model: [{ role: "user", content: [{ type: "text", text: "x" }, screenshot] }],
      },
    ]);
    expect(imageRefsOf(view)).toEqual([
      { entryId: "1", source: "user", src: "data:image/png;base64,aGVsbG8=" },
    ]);
  });

  it("marks tool-result images as agent images", () => {
    const view = viewOf([
      { id: 7, kind: "pi.tool-result", model: [{ role: "toolResult", content: [screenshot] }] },
    ]);
    expect(imageRefsOf(view)).toMatchObject([{ entryId: "7", source: "agent" }]);
  });

  it("skips string content, malformed blocks and entries without a model", () => {
    const view = viewOf([
      { id: 1, kind: "pi.user", model: [{ role: "user", content: "text" }] },
      { id: 2, kind: "pi.user", model: [{ role: "user", content: [{ type: "image", data: 5 }, null] }] },
      { id: 3, kind: "pi.user" },
    ]);
    expect(imageRefsOf(view)).toEqual([]);
  });
});
