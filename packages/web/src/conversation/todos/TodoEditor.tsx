import { isAppError, TODO_CONTENT_MAX_LENGTH, TODOS_MAX_ITEMS } from "@tau/protocol";
import { Check, Circle, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { newRequestId } from "@/conversation/use-conversation-actions";
import { cn } from "@/lib/utils";
import { useApi } from "@/nodes/node-context";
import type { TodoItem, TodoStatus } from "./todo-items";

const NEXT_STATUS: Record<TodoStatus, TodoStatus> = {
  pending: "in_progress",
  in_progress: "completed",
  completed: "pending",
};

const STATUS_LABEL: Record<TodoStatus, string> = {
  pending: "Mark in progress",
  in_progress: "Mark completed",
  completed: "Mark pending",
};

function StatusButton({ status, onCycle }: { status: TodoStatus; onCycle: () => void }) {
  const className = "size-3.5 shrink-0";
  return (
    <button
      type="button"
      onClick={onCycle}
      aria-label={STATUS_LABEL[status]}
      className="mt-1.5 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {status === "completed" ? (
        <Check aria-hidden className={cn(className, "text-success")} />
      ) : status === "in_progress" ? (
        <Loader2 aria-hidden className={cn(className, "animate-spin text-muted-foreground")} />
      ) : (
        <Circle aria-hidden className={cn(className, "text-muted-foreground")} />
      )}
    </button>
  );
}

export function TodoEditor({
  conversationId,
  initial,
  onDone,
  onCancel,
}: {
  conversationId: string;
  initial: readonly TodoItem[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const [draft, setDraft] = useState<TodoItem[]>(initial.map((todo) => ({ ...todo })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const patch = (index: number, value: Partial<TodoItem>) =>
    setDraft((current) => current.map((todo, at) => (at === index ? { ...todo, ...value } : todo)));

  const save = async () => {
    const todos = draft
      .map((todo) => ({ content: todo.content.trim(), status: todo.status }))
      .filter((todo) => todo.content !== "");
    const tooLong = todos.find((todo) => todo.content.length > TODO_CONTENT_MAX_LENGTH);
    if (tooLong) {
      setError(`Keep each todo under ${TODO_CONTENT_MAX_LENGTH} characters.`);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await api.conversations.updateTodos(conversationId, { todos, requestId: newRequestId() });
      onDone();
    } catch (saveError) {
      setError(isAppError(saveError) ? saveError.message : "Could not save the todo list.");
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1">
      <ul className="space-y-1">
        {draft.map((todo, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the draft is positional, items have no id
          <li key={index} className="flex items-start gap-2">
            <StatusButton
              status={todo.status}
              onCycle={() => patch(index, { status: NEXT_STATUS[todo.status] })}
            />
            <Input
              value={todo.content}
              onChange={(event) => patch(index, { content: event.target.value })}
              aria-label={`Todo ${index + 1}`}
              maxLength={TODO_CONTENT_MAX_LENGTH + 1}
              className="h-7 text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete todo ${index + 1}`}
              onClick={() => setDraft((current) => current.filter((_, at) => at !== index))}
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-1 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={draft.length >= TODOS_MAX_ITEMS}
          onClick={() => setDraft((current) => [...current, { content: "", status: "pending" }])}
        >
          <Plus aria-hidden />
          Add
        </Button>
        <span className="flex-1" />
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="default" size="sm" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
