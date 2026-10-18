import { ListChecks } from "lucide-react";
import { useIsSupersededTodoCall } from "../todos/latest-todo-call";
import { parseTodos, todoSummary } from "../todos/todo-items";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

/** Transcript shows only a one-line summary; the full list lives in the panel above the input. */
export function TodoTool({ state }: ToolRendererProps) {
  const todos = parseTodos(state.call.arguments?.todos);
  const superseded = useIsSupersededTodoCall(state.call.id);
  return (
    <ToolCard
      icon={<ListChecks />}
      title={superseded ? "Updated todos" : "Todos"}
      subtitle={todoSummary(todos)}
      status={state.status}
    />
  );
}
