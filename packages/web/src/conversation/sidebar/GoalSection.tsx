import { useQueryClient } from "@tanstack/react-query";
import { GOAL_CONDITION_MAX_LENGTH } from "@tau/protocol";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNow } from "@/conversation/use-now";
import { conditionTooLong, goalStatusFields } from "@/goal/goal-status";
import { errorMessage } from "@/lib/error-message";
import { useGoal } from "@/lib/queries";
import { useApi } from "@/nodes/node-context";
import { SidebarSection } from "./SidebarSection";

function GoalEditor({
  conversationId,
  initial,
  onDone,
  onCancel,
}: {
  conversationId: string;
  initial: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [condition, setCondition] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const save = async () => {
    const trimmed = condition.trim();
    if (!trimmed) {
      setError("Describe the goal first.");
      return;
    }
    if (conditionTooLong(trimmed)) {
      setError(
        `A goal condition has at most ${GOAL_CONDITION_MAX_LENGTH.toLocaleString("en-US")} characters.`,
      );
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await api.goals.set(conversationId, trimmed);
      await queryClient.invalidateQueries({ queryKey: ["goal"] });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      onDone();
    } catch (saveError) {
      setError(errorMessage(saveError));
      setSaving(false);
    }
  };
  return (
    <div className="space-y-2">
      <Input
        value={condition}
        onChange={(event) => setCondition(event.target.value)}
        aria-label="Goal condition"
        maxLength={GOAL_CONDITION_MAX_LENGTH + 1}
        className="h-7 text-sm"
      />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-1">
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

export function GoalSection({ conversationId }: { conversationId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const goal = useGoal(conversationId).data;
  const now = useNow(15_000);
  const [editing, setEditing] = useState(false);
  if (!goal) return null;
  const clear = () =>
    api.goals
      .clear(conversationId)
      .then(() => queryClient.invalidateQueries({ queryKey: ["goal"] }))
      .catch((error: unknown) => void toast.error(errorMessage(error)));
  return (
    <SidebarSection
      title="Goal"
      actions={
        editing ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Edit goal"
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden />
          </Button>
        )
      }
    >
      {editing ? (
        <GoalEditor
          conversationId={conversationId}
          initial={goal.condition}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <dl className="flex flex-col gap-1">
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
        </>
      )}
    </SidebarSection>
  );
}
