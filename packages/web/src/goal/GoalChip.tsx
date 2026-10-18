import { useQueryClient } from "@tanstack/react-query";
import type { Goal, GoalState } from "@tau/protocol";
import { CircleCheckIcon, CircleXIcon, PauseIcon, TargetIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNow } from "@/conversation/use-now";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/error-message";
import { useGoal } from "@/lib/queries";
import { goalStatusFields, stateLabel } from "./goal-status";

const ICONS: Record<GoalState, typeof TargetIcon> = {
  active: TargetIcon,
  paused: PauseIcon,
  achieved: CircleCheckIcon,
  failed: CircleXIcon,
  cleared: TargetIcon,
};

const chipText = (goal: Goal) => (goal.state === "active" ? "Goal" : `Goal · ${stateLabel(goal.state)}`);

function GoalDetails({ goal, onClear }: { goal: Goal; onClear: () => void }) {
  const now = useNow(15_000);
  return (
    <PopoverContent align="end" className="w-80" data-testid="goal-popover">
      <PopoverHeader>
        <PopoverTitle>Goal</PopoverTitle>
      </PopoverHeader>
      <dl className="flex flex-col gap-1.5">
        {goalStatusFields(goal, now).map(({ label, value }) => (
          <div key={label} className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <Button variant="outline" size="sm" onClick={onClear}>
        Clear
      </Button>
    </PopoverContent>
  );
}

/** The "Goal" chip of a thread, in the header and in the composer; it shows nothing without a goal. */
export function GoalChip({ conversationId }: { conversationId: string }) {
  const goal = useGoal(conversationId).data;
  const queryClient = useQueryClient();
  if (!goal) return null;
  const Icon = ICONS[goal.state];
  const clear = () =>
    api.goals
      .clear(conversationId)
      .then(() => queryClient.invalidateQueries({ queryKey: ["goal"] }))
      .catch((error: unknown) => void toast.error(errorMessage(error)));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Goal ${stateLabel(goal.state)}`}>
          <Icon />
          {chipText(goal)}
        </Button>
      </PopoverTrigger>
      <GoalDetails goal={goal} onClear={clear} />
    </Popover>
  );
}
