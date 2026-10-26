import { type ConversationView, todosProjectionOf } from "@tau/protocol";
import { ChevronRight, ListChecks, Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MorphText } from "@/components/ui/morph-text";
import { TodoEditor } from "./TodoEditor";
import { TodoList } from "./TodoList";
import { doneCount, isFinished } from "./todo-items";

export function TodoPanel({ conversationId, view }: { conversationId: string; view: ConversationView }) {
  const { items: todos } = todosProjectionOf(view);
  const [editing, setEditing] = useState(false);
  if (!editing && isFinished(todos)) return null;
  return (
    <Collapsible
      defaultOpen
      data-testid="todo-panel"
      className="group/todos rounded-lg border bg-card text-card-foreground"
    >
      <div className="flex items-center gap-1 px-1.5 py-1 text-xs text-muted-foreground">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1.5 py-0.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <ChevronRight
            aria-hidden
            className="size-3.5 transition-transform group-data-[state=open]/todos:rotate-90"
          />
          <ListChecks aria-hidden className="size-3.5" />
          <span className="font-medium">Todos</span>
          <MorphText>{`${doneCount(todos)}/${todos.length}`}</MorphText>
        </CollapsibleTrigger>
        {editing ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Edit todos"
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden />
          </Button>
        )}
      </div>
      <CollapsibleContent className="border-t px-3 py-2">
        {editing ? (
          <TodoEditor
            conversationId={conversationId}
            initial={todos}
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <TodoList todos={todos} />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
