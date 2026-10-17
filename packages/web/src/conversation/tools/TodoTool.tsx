import { ListChecks } from "lucide-react";
import { TodoList } from "../todos/TodoList";
import { doneCount, parseTodos } from "../todos/todo-items";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

export function TodoTool({ state }: ToolRendererProps) {
  const todos = parseTodos(state.call.arguments?.todos);
  return (
    <ToolCard
      icon={<ListChecks />}
      title="Todos"
      subtitle={todos.length ? `${doneCount(todos)}/${todos.length} done` : undefined}
      status={state.status}
      defaultOpen
    >
      {todos.length ? <TodoList todos={todos} /> : null}
    </ToolCard>
  );
}
