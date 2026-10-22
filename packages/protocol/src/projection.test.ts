import { describe, expect, it } from "vitest";
import {
  agentInfoOf,
  contextUsageInputOf,
  imageRefsOf,
  parseMvpNotification,
  parseSubagentNotification,
  todosProjectionOf,
  transcriptOf,
  userImages,
  userText,
} from "./projection";
import { TODOS_UPDATED_KIND } from "./todos";
import type { ConversationView, EntryRecord, UserMessage } from "./view";

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

describe("todosProjectionOf", () => {
  const agentTodos = [{ content: "a", status: "pending" }];
  const userTodos = [{ content: "b", status: "completed" }];
  const todoWrite = (id: number, todos: unknown) =>
    ({
      id,
      kind: "pi.assistant",
      model: [
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "t", name: "todo_write", arguments: { todos } }],
        },
      ],
    }) as unknown as EntryRecord;
  const todosEdit = (id: number, todos: unknown) =>
    ({ id, kind: TODOS_UPDATED_KIND, data: { todos } }) as unknown as EntryRecord;

  it("reads the items and source of the agent todo_write call", () => {
    expect(todosProjectionOf(viewOf([todoWrite(1, agentTodos)]))).toEqual({
      items: agentTodos,
      source: "call:t",
    });
  });

  it("lets a newer user edit win over the agent list", () => {
    const view = viewOf([todoWrite(1, agentTodos), todosEdit(2, userTodos)]);
    expect(todosProjectionOf(view)).toEqual({ items: userTodos, source: "edit:2" });
  });

  it("is empty without any todo event", () => {
    expect(todosProjectionOf(viewOf([user(1, "hi")]))).toEqual({ items: [], source: undefined });
    expect(todosProjectionOf(viewOf())).toEqual({ items: [], source: undefined });
  });
});

describe("transcriptOf", () => {
  const toolResult = (id: number, toolCallId: string, data?: unknown) =>
    ({
      id,
      kind: "pi.tool-result",
      data,
      model: [{ role: "toolResult", toolCallId, content: [], isError: false }],
    }) as unknown as EntryRecord;

  it("is empty for an empty view", () => {
    const transcript = transcriptOf(viewOf());
    expect(transcript.items).toEqual([]);
    expect(transcript.results.size).toBe(0);
  });

  it("keys items by kind and id and keeps the user text and images", () => {
    const entry = {
      id: 7,
      kind: "pi.user",
      model: [{ role: "user", content: [{ type: "text", text: "see" }, screenshot] }],
    } as unknown as EntryRecord;
    expect(transcriptOf(viewOf([entry])).items).toEqual([
      { kind: "user", key: "pi.user:7", entryId: "7", text: "see", images: [screenshot] },
    ]);
  });

  it("hides user messages that start with a notification tag", () => {
    expect(transcriptOf(viewOf([user(1, "<notice>x"), user(2, "hi")])).items).toHaveLength(1);
  });

  it("maps compaction and retry entries to bare items", () => {
    const retry = { id: 2, kind: "app.retry" } as unknown as EntryRecord;
    expect(transcriptOf(viewOf([compaction(1, 2), retry])).items).toEqual([
      { kind: "compaction", key: "pi.compaction:1" },
      { kind: "retry", key: "app.retry:2" },
    ]);
  });

  it("indexes tool results by call id with their diagnostics, the last one winning", () => {
    const diagnostics = [{ severity: "info", message: "exit code 1", code: "exit_code" }];
    const { results } = transcriptOf(viewOf([toolResult(1, "a"), toolResult(2, "a", { diagnostics })]));
    expect(results.get("a")?.diagnostics).toEqual(diagnostics);
    expect(results.size).toBe(1);
  });

  it("skips entries whose message role does not match the entry kind", () => {
    const mismatched = { id: 1, kind: "pi.assistant", model: [{ role: "user", content: "x" }] };
    const bare = { id: 2, kind: "pi.user" };
    expect(transcriptOf(viewOf([mismatched, bare])).items).toEqual([]);
  });
});

describe("notification parsing", () => {
  it("parses a valid MVP notification and rejects bad data or unknown kinds", () => {
    expect(parseMvpNotification("app.notice", { text: "hi" })).toEqual({
      kind: "notice",
      data: { text: "hi" },
    });
    expect(parseMvpNotification("app.notice", { text: 1 })).toBeUndefined();
    expect(parseMvpNotification("pi.user", { text: "hi" })).toBeUndefined();
  });

  it("parses subagent notification data", () => {
    const data = { childId: "k", status: "done", title: "t", report: "r" };
    expect(parseSubagentNotification(data)).toEqual(data);
    expect(parseSubagentNotification({ childId: 1 })).toBeUndefined();
  });

  it("turns subagent entries into transcript items", () => {
    const data = { childId: "k", status: "failed", title: "t", report: "r" };
    const entry = { id: 3, kind: "app.subagent_notification", data } as unknown as EntryRecord;
    expect(transcriptOf(viewOf([entry])).items).toEqual([
      { kind: "subagent-notification", key: "app.subagent_notification:3", data },
    ]);
  });
});

describe("userText and userImages", () => {
  it("joins text blocks and filters images", () => {
    const message = {
      role: "user",
      content: [{ type: "text", text: "a" }, screenshot, { type: "text", text: "b" }],
    } as unknown as UserMessage;
    expect(userText(message)).toBe("a\nb");
    expect(userImages(message)).toEqual([screenshot]);
  });

  it("handles string content", () => {
    const message = { role: "user", content: "plain" } as unknown as UserMessage;
    expect(userText(message)).toBe("plain");
    expect(userImages(message)).toEqual([]);
  });
});
