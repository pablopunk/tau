import { type ConversationView, TODOS_UPDATED_KIND, type TodoItem } from "@tau/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type FauxWorld,
  openFauxWorld,
  setUpConversation,
  trackView,
  waitForAnswer,
} from "./test-support/faux-core";
import { useTempDir } from "./test-support/temp-dir";

const tempDir = useTempDir();
let clock: number;
let world: FauxWorld;

beforeEach(async () => {
  clock = 1_000;
  world = await openFauxWorld(await tempDir(), () => ++clock);
});

afterEach(() => world.core.close());

const todoEntriesOf = (tracker: { view(): ConversationView | null }) =>
  (tracker.view()?.entries ?? []).filter((entry) => entry.kind === TODOS_UPDATED_KIND);

const todosOf = async (id: string) => {
  const tracker = await trackView(world.core, id);
  try {
    return todoEntriesOf(tracker);
  } finally {
    await tracker.stop();
  }
};

const save = (id: string, todos: TodoItem[], requestId: string) =>
  world.core.conversations.updateTodos(id, { todos, requestId });

describe("conversations.updateTodos", () => {
  it("appends one app.todos_updated entry carrying the list, diff and requestId", async () => {
    const { conversation } = await setUpConversation(world);
    await save(
      conversation.id,
      [
        { content: "write tests", status: "in_progress" },
        { content: "ship it", status: "pending" },
      ],
      "u1",
    );
    const entries = await todosOf(conversation.id);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry?.data).toMatchObject({
      todos: [
        { content: "write tests", status: "in_progress" },
        { content: "ship it", status: "pending" },
      ],
      requestId: "u1",
    });
    const diff = (entry?.data as { diff?: unknown } | undefined)?.diff;
    expect(Array.isArray(diff) ? diff.join("\n") : "").toContain("write tests");
    expect(JSON.stringify(entry?.model)).toContain("<todos-updated>");
  });

  it("a repeated requestId is a no-op", async () => {
    const { conversation } = await setUpConversation(world);
    const todos: TodoItem[] = [{ content: "a", status: "pending" }];
    await save(conversation.id, todos, "u1");
    await save(conversation.id, [{ content: "b", status: "pending" }], "u1");
    const entries = await todosOf(conversation.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.data).toMatchObject({ todos });
  });

  it("rejects an empty item, an overlong item and more than 50 items", async () => {
    const { conversation } = await setUpConversation(world);
    await expect(save(conversation.id, [{ content: "", status: "pending" }], "u1")).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(
      save(conversation.id, [{ content: "x".repeat(501), status: "pending" }], "u2"),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      save(
        conversation.id,
        Array.from({ length: 51 }, (_, index) => ({ content: `t${index}`, status: "pending" as const })),
        "u3",
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(await todosOf(conversation.id)).toHaveLength(0);
  });

  it("rejects an unknown or deleted thread, but allows archived ones without unarchiving", async () => {
    const { conversation } = await setUpConversation(world);
    await expect(save("9999", [], "u1")).rejects.toMatchObject({ code: "not_found" });
    await world.core.conversations.archive(conversation.id, true);
    await save(conversation.id, [], "u2");
    expect(await todosOf(conversation.id)).toHaveLength(1);
    const [summary] = await world.core.conversations.listAll();
    expect(summary?.archivedAt).not.toBeNull();
  });

  it("pings the agent: an idle thread runs again after a user edit", async () => {
    const { conversation } = await setUpConversation(world);
    const tracker = await trackView(world.core, conversation.id);
    await save(conversation.id, [{ content: "do the thing", status: "pending" }], "u1");
    await waitForAnswer(tracker);
    await tracker.stop();
  });

  it("queues behind a run instead of interrupting: busy stays busy, edit lands after", async () => {
    const { conversation } = await setUpConversation(world);
    const tracker = await trackView(world.core, conversation.id);
    await world.core.conversations.send(conversation.id, { text: "todo slow thing", requestId: "r1" });
    await save(conversation.id, [{ content: "user edit", status: "pending" }], "u1");
    const deadline = Date.now() + 20_000;
    while (todoEntriesOf(tracker).length !== 1) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for the todo entry");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await waitForAnswer(tracker);
    await tracker.stop();
  });
});
