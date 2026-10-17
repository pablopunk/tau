import { defineExtension } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { type ToolFileFactory, unimplementedTool } from "./tool-file";

export const TodoWriteParameters = Type.Object({
  todos: Type.Array(
    Type.Object({
      content: Type.String(),
      status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")]),
    }),
  ),
});

/** Phase 1 (C): the list lives in a `pi-everywhere.todos` doc. */
export const todoWriteToolFile: ToolFileFactory = () => ({
  implemented: false,
  extension: defineExtension({
    name: "todo-write",
    tools: [unimplementedTool("todo_write", "Replace the thread's todo list.", TodoWriteParameters, "safe")],
  }),
});
