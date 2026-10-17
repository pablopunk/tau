export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  readonly content: string;
  readonly status: TodoStatus;
}

export const TODOS_DOC_KIND = "pi-everywhere.todos";

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

export const isFinished = (todos: readonly TodoItem[]) =>
  todos.length === 0 || doneCount(todos) === todos.length;
