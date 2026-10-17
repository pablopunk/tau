import { Check, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TodoItem, TodoStatus } from "./todo-items";

const LABELS: Record<TodoStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
};

function StatusMark({ status }: { status: TodoStatus }) {
  const className = "mt-0.5 size-3.5 shrink-0";
  if (status === "completed") return <Check aria-hidden className={cn(className, "text-success")} />;
  if (status === "in_progress") {
    return <Loader2 aria-hidden className={cn(className, "animate-spin text-muted-foreground")} />;
  }
  return <Circle aria-hidden className={cn(className, "text-muted-foreground")} />;
}

export function TodoList({ todos }: { todos: readonly TodoItem[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {todos.map((todo, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a list is replaced whole, items have no id
        <li key={index} className="flex items-start gap-2" data-status={todo.status}>
          <StatusMark status={todo.status} />
          <span className={cn(todo.status === "completed" && "text-muted-foreground line-through")}>
            {todo.content}
          </span>
          <span className="sr-only">{LABELS[todo.status]}</span>
        </li>
      ))}
    </ul>
  );
}
