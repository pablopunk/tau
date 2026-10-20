import { describe, expect, it } from "vitest";
import { isNotificationText } from "./mvp8";
import { diffTodos, latestTodoSource, latestTodos, TODOS_UPDATED_KIND, todosUpdatedText } from "./todos";
import type { ConversationView } from "./view";

const todoEntry = (id: number, todos: unknown) => ({
  id,
  kind: "pi.assistant",
  model: [
    { role: "assistant", content: [{ type: "toolCall", id: "t", name: "todo_write", arguments: { todos } }] },
  ],
});

const editEntry = (id: number, todos: unknown) => ({ id, kind: TODOS_UPDATED_KIND, data: { todos } });

const viewWith = (...entries: unknown[]): ConversationView => ({ entries }) as unknown as ConversationView;

describe("latestTodoSource", () => {
  it("namespaces agent calls and user edits, newest entry wins", () => {
    expect(latestTodoSource(viewWith(todoEntry(1, [])))).toBe("call:t");
    expect(latestTodoSource(viewWith(todoEntry(1, []), editEntry(2, [])))).toBe("edit:2");
    expect(latestTodoSource(viewWith(editEntry(1, []), todoEntry(2, [])))).toBe("call:t");
    expect(latestTodoSource(viewWith())).toBeUndefined();
  });
});

describe("latestTodos", () => {
  it("reads the newest event of either kind", () => {
    const agent = [{ content: "a", status: "pending" }];
    const user = [{ content: "b", status: "completed" }];
    expect(latestTodos(viewWith(todoEntry(1, agent), editEntry(2, user)))).toEqual(user);
    expect(latestTodos(viewWith(editEntry(1, user), todoEntry(2, agent)))).toEqual(agent);
  });
});

describe("diffTodos", () => {
  it("lists added, removed, reworded-by-content and status changes", () => {
    const diff = diffTodos(
      [
        { content: "a", status: "pending" },
        { content: "gone", status: "pending" },
      ],
      [
        { content: "a", status: "completed" },
        { content: "new", status: "in_progress" },
      ],
    );
    expect(diff).toEqual(['"a": pending → completed', 'added "new" (in_progress)', 'removed "gone"']);
  });
});

describe("todosUpdatedText", () => {
  it("is hidden from the transcript like other notifications", () => {
    const text = todosUpdatedText([{ content: "a", status: "pending" }], ['added "a" (pending)']);
    expect(isNotificationText(text)).toBe(true);
    expect(text).toContain("a");
  });
});
