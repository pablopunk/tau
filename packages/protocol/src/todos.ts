import { Type } from "typebox";
import type { ConversationView } from "./view";

export const TODOS_UPDATED_KIND = "app.todos_updated";

export const TODO_CONTENT_MAX_LENGTH = 500;
export const TODOS_MAX_ITEMS = 50;
const TODOS_TEXT_TRUNCATE = 120;

export const TodoStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in_progress"),
  Type.Literal("completed"),
]);
export type TodoStatus = Type.Static<typeof TodoStatusSchema>;

export const TodoItemSchema = Type.Object({
  content: Type.String({ minLength: 1, maxLength: TODO_CONTENT_MAX_LENGTH }),
  status: TodoStatusSchema,
});
export type TodoItem = Type.Static<typeof TodoItemSchema>;

export const UpdateTodosInputSchema = Type.Object({
  todos: Type.Array(TodoItemSchema, { maxItems: TODOS_MAX_ITEMS }),
  requestId: Type.String({ minLength: 1 }),
});
export type UpdateTodosInput = Type.Static<typeof UpdateTodosInputSchema>;

export const TodosUpdatedDataSchema = Type.Object({
  todos: Type.Array(TodoItemSchema),
  diff: Type.Array(Type.String()),
  requestId: Type.String({ minLength: 1 }),
});
export type TodosUpdatedData = Type.Static<typeof TodosUpdatedDataSchema>;

const STATUSES: readonly string[] = ["pending", "in_progress", "completed"];

function isTodoItem(value: unknown): value is TodoItem {
  const item = value as { content?: unknown; status?: unknown } | null;
  return (
    typeof item?.content === "string" &&
    item.content.length >= 1 &&
    item.content.length <= TODO_CONTENT_MAX_LENGTH &&
    STATUSES.includes(item.status as string)
  );
}

export function parseTodos(value: unknown): TodoItem[] {
  return Array.isArray(value) ? value.filter(isTodoItem) : [];
}

type TodoCallBlock = { type?: string; id?: string; name?: string; arguments?: { todos?: unknown } };

const todoCallsOf = (entry: ConversationView["entries"][number]): TodoCallBlock[] => {
  const content = (entry.model?.[0] as { content?: unknown } | undefined)?.content;
  if (entry.kind !== "pi.assistant" || !Array.isArray(content)) return [];
  return (content as TodoCallBlock[]).filter(
    (block) => block.type === "toolCall" && block.name === "todo_write",
  );
};

/**
 * Namespaced token of the newest todo event: `call:<toolCallId>` for the agent's
 * latest `todo_write`, `edit:<entryId>` for the user's latest `app.todos_updated`.
 * Newest entry wins — a user edit is authoritative state, not a preview.
 */
export function latestTodoSource(view: ConversationView): string | undefined {
  for (let index = view.entries.length - 1; index >= 0; index--) {
    const entry = view.entries[index];
    if (!entry) continue;
    if (entry.kind === TODOS_UPDATED_KIND) return `edit:${String(entry.id)}`;
    const call = todoCallsOf(entry).at(-1);
    if (call?.id) return `call:${call.id}`;
  }
  return undefined;
}

/** The user's current list: the `todos` of the newest todo event, or `[]`. */
export function latestTodos(view: ConversationView): TodoItem[] {
  for (let index = view.entries.length - 1; index >= 0; index--) {
    const entry = view.entries[index];
    if (!entry) continue;
    if (entry.kind === TODOS_UPDATED_KIND) {
      return parseTodos((entry.data as { todos?: unknown } | undefined)?.todos);
    }
    const call = todoCallsOf(entry).at(-1);
    if (call) return parseTodos(call.arguments?.todos);
  }
  return [];
}

/** Human-readable lines describing how `after` differs from `before`. Best-effort narrative. */
export function diffTodos(before: readonly TodoItem[], after: readonly TodoItem[]): string[] {
  const diff: string[] = [];
  const beforeByContent = new Map(before.map((todo) => [todo.content, todo.status]));
  const afterByContent = new Map(after.map((todo) => [todo.content, todo.status]));
  for (const todo of after) {
    const previous = beforeByContent.get(todo.content);
    if (previous === undefined) diff.push(`added "${todo.content}" (${todo.status})`);
    else if (previous !== todo.status) diff.push(`"${todo.content}": ${previous} → ${todo.status}`);
  }
  for (const todo of before) {
    if (!afterByContent.has(todo.content)) diff.push(`removed "${todo.content}"`);
  }
  return diff;
}

const shorten = (text: string): string =>
  text.length <= TODOS_TEXT_TRUNCATE ? text : `${text.slice(0, TODOS_TEXT_TRUNCATE - 1)}…`;

const describeTodo = (todo: TodoItem): string => `[${todo.status}] ${shorten(todo.content)}`;

/** The `<todos-updated>` text the model reads; hidden from the transcript like other notifications. */
export function todosUpdatedText(todos: readonly TodoItem[], diff: readonly string[]): string {
  const lines = diff.length === 0 ? ["no changes listed"] : diff.map(shorten);
  const list = todos.length === 0 ? "(empty)" : todos.map(describeTodo).join("\n");
  return `<todos-updated>\nUser updated the todo list:\n${lines.map((line) => `- ${line}`).join("\n")}\nCurrent list:\n${list}\n</todos-updated>`;
}
