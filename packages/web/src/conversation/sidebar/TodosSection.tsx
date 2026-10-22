import { type ConversationView, todosProjectionOf } from "@tau/protocol";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TodoEditor } from "../todos/TodoEditor";
import { TodoList } from "../todos/TodoList";
import { doneCount, isFinished } from "../todos/todo-items";
import { SidebarSection } from "./SidebarSection";
import { useAutoExpand } from "./use-auto-expand";

export function TodosSection({
  conversationId,
  view,
  revealed,
}: {
  conversationId: string;
  view: ConversationView;
  revealed?: boolean;
}) {
  const { items: todos } = todosProjectionOf(view);
  const todosVisible = !isFinished(todos);
  const [editing, setEditing] = useState(false);
  const expanded = useAutoExpand(todosVisible || editing || revealed === true);
  if (!todosVisible && !editing) return null;
  return (
    <SidebarSection
      sectionId="todos"
      title="Todos"
      count={todosVisible ? todos.length : undefined}
      open={expanded.open}
      onOpenChange={expanded.onOpenChange}
      actions={
        editing ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Edit todos"
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden />
          </Button>
        )
      }
    >
      {editing ? (
        <TodoEditor
          conversationId={conversationId}
          initial={todos}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <p className="mb-1.5 text-xs text-muted-foreground">
            {doneCount(todos)}/{todos.length} done
          </p>
          <TodoList todos={todos} />
        </>
      )}
    </SidebarSection>
  );
}
