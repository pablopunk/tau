import { DEFAULT_RESOURCE_SETTINGS, type ResourceSettings } from "@tau/protocol";
import { describe, expect, it, vi } from "vitest";
import type { IndexedConversation } from "../../harness/conversation-docs";
import { classifyThread, isGoverned } from "./governed";

const settings = (patch: Partial<ResourceSettings> = {}): ResourceSettings => ({
  ...DEFAULT_RESOURCE_SETTINGS,
  levels: { main: "balanced", worktree: "balanced", subagent: "balanced" },
  ...patch,
});
const levels = (
  main: "off" | "balanced" | "background",
  worktree: "off" | "balanced" | "background",
  subagent: "off" | "balanced" | "background",
) => ({
  levels: { main, worktree, subagent },
});
const on = (main: boolean, worktree: boolean, subagent: boolean) =>
  levels(main ? "balanced" : "off", worktree ? "balanced" : "off", subagent ? "balanced" : "off");
const entry = (patch: Partial<IndexedConversation>): IndexedConversation => ({
  conversationId: 1,
  title: "t",
  createdAt: 0,
  updatedAt: 0,
  ...patch,
});
const worktree = { mode: "worktree" } as IndexedConversation["workspace"];
const checkout = { mode: "checkout" } as IndexedConversation["workspace"];

describe("classifyThread", () => {
  it("main, worktree and subagent", () => {
    expect(classifyThread(entry({ workspace: checkout }))).toBe("main");
    expect(classifyThread(entry({}))).toBe("main");
    expect(classifyThread(entry({ workspace: worktree }))).toBe("worktree");
    expect(classifyThread(entry({ parentId: "7" }))).toBe("subagent");
  });

  it("a subagent of a worktree thread is a subagent; a user fork classifies by workspace", () => {
    expect(classifyThread(entry({ parentId: "7", workspace: worktree }))).toBe("subagent");
    expect(
      classifyThread(entry({ forkOf: { conversationId: "7", entryId: "e" }, workspace: worktree })),
    ).toBe("worktree");
    expect(classifyThread(entry({ forkOf: { conversationId: "7", entryId: "e" } }))).toBe("main");
  });
});

describe("isGoverned", () => {
  const governed = (patch: Partial<ResourceSettings>, found: IndexedConversation | undefined) =>
    isGoverned(settings(patch), async () => found);

  it("is governed exactly when its own scope is not off", async () => {
    const cases: Array<[string, IndexedConversation, [boolean, boolean, boolean]]> = [
      ["main", entry({ workspace: checkout }), [true, false, false]],
      ["worktree", entry({ workspace: worktree }), [false, true, false]],
      ["subagent", entry({ parentId: "9" }), [false, false, true]],
      ["task child without agentType", entry({ parentId: "9", workspace: worktree }), [false, false, true]],
    ];
    for (const [, thread, own] of cases) {
      for (const [index] of [0, 1, 2].entries()) {
        const boxes = [false, false, false] as [boolean, boolean, boolean];
        boxes[index] = true;
        const expected = own[index] === true;
        expect(await governed(on(...boxes), thread)).toBe(expected);
      }
    }
  });

  it("an unknown or deleted thread is ungoverned", async () => {
    expect(await governed(on(true, true, true), undefined)).toBe(false);
    expect(await governed(on(true, true, true), entry({ deletedAt: 5 }))).toBe(false);
  });

  it("a lookup that throws is ungoverned", async () => {
    const find = vi.fn(async () => {
      throw new Error("index unavailable");
    });
    expect(await isGoverned(settings(on(true, true, true)), find)).toBe(false);
  });

  it("never looks the thread up while every control is Off", async () => {
    const find = vi.fn(async () => entry({}));
    expect(await isGoverned(DEFAULT_RESOURCE_SETTINGS, find)).toBe(false);
    expect(await isGoverned(settings(on(false, false, false)), find)).toBe(false);
    expect(find).not.toHaveBeenCalled();
    expect(
      await isGoverned(settings({ levels: { main: "balanced", worktree: "off", subagent: "off" } }), find),
    ).toBe(true);
    expect(find).toHaveBeenCalledTimes(1);
  });
});
