import { DEFAULT_RESOURCE_SETTINGS, DEFAULT_SANDBOX_SETTINGS, type ResourceSettings } from "@tau/protocol";
import { describe, expect, it, vi } from "vitest";
import type { IndexedConversation } from "../../harness/conversation-docs";
import { callScopes, classifyThread, isGoverned, scopeFields } from "./governed";

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

describe("callScopes", () => {
  const sandboxOn = (main: boolean, worktree: boolean, subagent: boolean) => ({ main, worktree, subagent });
  const resourceOff = settings(levels("off", "off", "off"));

  it("carries the worktree sandbox scope while its resource level is Off", async () => {
    const scopes = await callScopes(
      settings(levels("balanced", "off", "off")),
      sandboxOn(false, true, false),
      async () => entry({ workspace: worktree }),
    );
    expect(scopes).toEqual({ sandboxScope: "worktree" });
    expect(scopeFields(scopes)).toEqual({ sandboxScope: "worktree" });
  });

  it("keeps the governor scope and the sandbox scope apart", async () => {
    const scopes = await callScopes(
      settings(levels("off", "balanced", "off")),
      sandboxOn(false, true, false),
      async () => entry({ workspace: worktree }),
    );
    expect(scopeFields(scopes)).toEqual({ governed: true, scope: "worktree", sandboxScope: "worktree" });
  });

  it("classifies a subagent for the sandbox even when only main is governed", async () => {
    const scopes = await callScopes(
      settings(levels("balanced", "off", "off")),
      sandboxOn(false, false, true),
      async () => entry({ parentId: "9" }),
    );
    expect(scopes).toEqual({ sandboxScope: "subagent" });
  });

  it("marks an unknown, deleted or failing lookup unknown for the sandbox, never main", async () => {
    const sandbox = sandboxOn(false, true, false);
    const failing = async (): Promise<IndexedConversation | undefined> => {
      throw new Error("index unavailable");
    };
    expect(await callScopes(resourceOff, sandbox, async () => undefined)).toEqual({
      sandboxScope: "unknown",
    });
    expect(await callScopes(resourceOff, sandbox, async () => entry({ deletedAt: 5 }))).toEqual({
      sandboxScope: "unknown",
    });
    expect(await callScopes(resourceOff, sandbox, failing)).toEqual({ sandboxScope: "unknown" });
  });

  it("looks the thread up once, and not at all while resource control and the sandbox are Off", async () => {
    const find = vi.fn(async () => entry({ workspace: worktree }));
    expect(await callScopes(resourceOff, DEFAULT_SANDBOX_SETTINGS, find)).toEqual({});
    expect(find).not.toHaveBeenCalled();
    await callScopes(settings(on(true, true, true)), sandboxOn(true, true, true), find);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("leaves a resource-governed main thread without a sandbox scope when the sandbox is Off", async () => {
    const scopes = await callScopes(settings(on(true, false, false)), DEFAULT_SANDBOX_SETTINGS, async () =>
      entry({ workspace: checkout }),
    );
    expect(scopeFields(scopes)).toEqual({ governed: true, scope: "main" });
  });
});
