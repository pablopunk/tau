import type { ConversationView } from "@tau/protocol";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  readonly content: string;
  readonly status: TodoStatus;
}

const STATUSES: readonly string[] = ["pending", "in_progress", "completed"];

function isTodoItem(value: unknown): value is TodoItem {
  const item = value as { content?: unknown; status?: unknown } | null;
  return typeof item?.content === "string" && STATUSES.includes(item.status as string);
}

export function parseTodos(value: unknown): TodoItem[] {
  return Array.isArray(value) ? value.filter(isTodoItem) : [];
}

export const doneCount = (todos: readonly TodoItem[]) =>
  todos.filter((todo) => todo.status === "completed").length;

/** Compact one-line summary for the transcript. The full list lives in the panel above the input. */
export function todoSummary(todos: readonly TodoItem[]): string | undefined {
  if (todos.length === 0) return undefined;
  const base = `${doneCount(todos)}/${todos.length} done`;
  const current = todos.find((todo) => todo.status === "in_progress")?.content;
  return current ? `${base} \u2192 ${current}` : base;
}

export const isFinished = (todos: readonly TodoItem[]) =>
  todos.length === 0 || doneCount(todos) === todos.length;

type ToolCallBlock = { type?: string; id?: string; name?: string; arguments?: { todos?: unknown } };

const todoCallsOf = (entry: ConversationView["entries"][number]): ToolCallBlock[] => {
  const content = (entry.model?.[0] as { content?: unknown } | undefined)?.content;
  if (entry.kind !== "pi.assistant" || !Array.isArray(content)) return [];
  return content.filter((block: ToolCallBlock) => block.type === "toolCall" && block.name === "todo_write");
};

/** The view carries only built-in documents, so the list is the arguments of the newest `todo_write` call. */
export function latestTodos(view: ConversationView): TodoItem[] {
  for (let index = view.entries.length - 1; index >= 0; index--) {
    const entry = view.entries[index];
    const call = entry ? todoCallsOf(entry).at(-1) : undefined;
    if (call) return parseTodos(call.arguments?.todos);
  }
  return [];
}

export function latestTodoCallId(view: ConversationView): string | undefined {
  for (let index = view.entries.length - 1; index >= 0; index--) {
    const entry = view.entries[index];
    const call = entry ? todoCallsOf(entry).at(-1) : undefined;
    if (call) return call.id;
  }
  return undefined;
}
