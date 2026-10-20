import type { ConversationView } from "@tau/protocol";
import { ChevronRight, ListChecks } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MorphText } from "@/components/ui/morph-text";
import { TodoList } from "./TodoList";
import { doneCount, isFinished, latestTodos } from "./todo-items";

export function TodoPanel({ view }: { conversationId: string; view: ConversationView }) {
  const todos = latestTodos(view);
  if (isFinished(todos)) return null;
  return (
    <Collapsible
      defaultOpen
      data-testid="todo-panel"
      className="group/todos rounded-lg border bg-card text-card-foreground"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRight
          aria-hidden
          className="size-3.5 transition-transform group-data-[state=open]/todos:rotate-90"
        />
        <ListChecks aria-hidden className="size-3.5" />
        <span className="font-medium">Todos</span>
        <MorphText>{`${doneCount(todos)}/${todos.length}`}</MorphText>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-2">
        <TodoList todos={todos} />
      </CollapsibleContent>
    </Collapsible>
  );
}
