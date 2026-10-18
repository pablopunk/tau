import type { EntryRecord } from "@tau/protocol";
import { describe, expect, it } from "vitest";
import { contextUsage } from "./context-usage";

const user = (id: string, text: string) =>
  ({ id, kind: "pi.user", model: [{ role: "user", content: text }] }) as unknown as EntryRecord;

const assistant = (id: string, usage: object) =>
  ({
    id,
    kind: "pi.assistant",
    model: [{ role: "assistant", content: [], usage }],
  }) as unknown as EntryRecord;

const compaction = (id: string, head: string) =>
  ({ id, kind: "pi.compaction", head, data: { reason: "manual" }, model: [] }) as unknown as EntryRecord;

describe("contextUsage", () => {
  it("is null without any usage", () => {
    expect(contextUsage([user("1", "hi")], 200_000)).toBeNull();
  });

  it("uses totalTokens of the last answer and labels it", () => {
    const entries = [user("1", "hi"), assistant("2", { totalTokens: 42_000 })];
    expect(contextUsage(entries, 200_000)).toEqual({
      used: 42_000,
      total: 200_000,
      label: "42k of 200k tokens · 21%",
    });
  });

  it("falls back to the parts when totalTokens is 0", () => {
    const usage = { totalTokens: 0, input: 100, cacheRead: 20, cacheWrite: 30, output: 50 };
    expect(contextUsage([assistant("1", usage)], 1000)?.used).toBe(200);
  });

  it("adds chars / 4 for messages after the last answer", () => {
    const entries = [assistant("1", { totalTokens: 100 }), user("2", "x".repeat(38))];
    expect(contextUsage(entries, 1000)?.used).toBe(100 + 10);
  });

  it("ignores usage before the latest compaction head", () => {
    const entries = [assistant("1", { totalTokens: 90_000 }), compaction("c", "3"), user("3", "kept")];
    expect(contextUsage(entries, 200_000)).toBeNull();
  });

  it("uses the kept answer after the compaction head", () => {
    const entries = [
      compaction("c", "3"),
      assistant("3", { totalTokens: 5_000 }),
      assistant("4", { totalTokens: 6_000 }),
    ];
    expect(contextUsage(entries, 200_000)?.used).toBe(6_000);
  });
});
