import { useQueryClient } from "@tanstack/react-query";
import type { ConversationView } from "@tau/protocol";
import { CircleCheckIcon, CircleXIcon, PauseIcon, TargetIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useNow } from "@/conversation/use-now";
import { goalStatusFields } from "@/goal/goal-status";
import { errorMessage } from "@/lib/error-message";
import { useGoal } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";
import { TodoList } from "../todos/TodoList";
import { doneCount, isFinished, latestTodos } from "../todos/todo-items";
import { SidebarSection } from "./SidebarSection";

function GoalBlock({ conversationId }: { conversationId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const goal = useGoal(conversationId).data;
  const now = useNow(15_000);
  if (!goal) return null;
  const Icon =
    goal.state === "active"
      ? TargetIcon
      : goal.state === "paused"
        ? PauseIcon
        : goal.state === "achieved"
          ? CircleCheckIcon
          : CircleXIcon;
  const clear = () =>
    api.goals
      .clear(conversationId)
      .then(() => queryClient.invalidateQueries({ queryKey: ["goal"] }))
      .catch((error: unknown) => void toast.error(errorMessage(error)));
  return (
    <div className="mb-2 border-b pb-2">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className="size-4 text-muted-foreground" />
        Goal
      </p>
      <dl className="mt-1.5 flex flex-col gap-1">
        {goalStatusFields(goal, now).map(({ label, value }) => (
          <div key={label} className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="break-words text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      <Button variant="outline" size="sm" className="mt-2" onClick={clear}>
        Clear
      </Button>
    </div>
  );
}

export function GoalTodosSection({
  conversationId,
  view,
}: {
  conversationId: string;
  view: ConversationView;
}) {
  const todos = latestTodos(view);
  const todosVisible = !isFinished(todos);
  return (
    <SidebarSection title="Todos" count={todosVisible ? todos.length : undefined} defaultOpen={todosVisible}>
      <GoalBlock conversationId={conversationId} />
      {todosVisible ? (
        <>
          <p className="mb-1.5 text-xs text-muted-foreground">
            {doneCount(todos)}/{todos.length} done
          </p>
          <TodoList todos={todos} />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">No open todos.</p>
      )}
    </SidebarSection>
  );
}
