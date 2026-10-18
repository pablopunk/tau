import { defineDoc, defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import type { ToolFileFactory } from "./tool-file";

export const TodoWriteParameters = Type.Object({
  todos: Type.Array(
    Type.Object({
      content: Type.String(),
      status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")]),
    }),
  ),
});

export type TodoItem = { content: string; status: "pending" | "in_progress" | "completed" };

export const TODOS_DOC_KIND = "tau.todos";

export const TodosDoc = defineDoc<{ todos: TodoItem[] }>({
  kind: TODOS_DOC_KIND,
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ todos: [] }),
});

export function summarizeTodos(todos: readonly TodoItem[]): string {
  const done = todos.filter((todo) => todo.status === "completed").length;
  const active = todos.find((todo) => todo.status === "in_progress");
  const current = active ? ` In progress: ${active.content}.` : "";
  return `Todos updated: ${done}/${todos.length} completed.${current}`;
}

export const todoWriteToolFile: ToolFileFactory = () => ({
  implemented: true,
  extension: defineExtension({
    name: "todo-write",
    tools: [
      defineTool({
        name: "todo_write",
        description:
          "Replace the thread's todo list with the full list. Keep one item in_progress while working, and mark items completed as you finish them.",
        parameters: TodoWriteParameters,
        replay: "safe",
        execute: async (args, api, context) => {
          await api.commit(async (tx) => {
            (await tx.doc(TodosDoc, api.conversationId)).todos = args.todos.map((todo) => ({ ...todo }));
          }, context);
          return {
            output: [{ type: "text", text: summarizeTodos(args.todos) }],
            details: { todos: args.todos },
          };
        },
      }),
    ],
  }),
});
