import type { TodoItem } from "@tau/protocol";

export type { TodoItem, TodoStatus } from "@tau/protocol";
export { latestTodoSource, latestTodos, parseTodos } from "@tau/protocol";

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
