import { ListChecks } from "lucide-react";
import { useIsSupersededTodoCall } from "../todos/latest-todo-call";
import { TodoList } from "../todos/TodoList";
import { doneCount, parseTodos } from "../todos/todo-items";
import { ToolCard } from "./ToolCard";
import type { ToolRendererProps } from "./types";

export function TodoTool({ state }: ToolRendererProps) {
  const todos = parseTodos(state.call.arguments?.todos);
  const superseded = useIsSupersededTodoCall(state.call.id);
  return (
    <ToolCard
      icon={<ListChecks />}
      title={superseded ? "Updated todos" : "Todos"}
      subtitle={todos.length ? `${doneCount(todos)}/${todos.length} done` : undefined}
      status={state.status}
      defaultOpen={!superseded}
    >
      {todos.length ? <TodoList todos={todos} /> : null}
    </ToolCard>
  );
}
