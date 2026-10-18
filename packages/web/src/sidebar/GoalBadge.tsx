import type { ConversationSummary } from "@tau/protocol";
import { TargetIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const hasActiveGoal = (conversation: ConversationSummary): boolean =>
  conversation.goal?.state === "active";

/** The target badge on the top right of an avatar while the thread has an active goal. */
export function GoalBadge({ conversation }: { conversation: ConversationSummary }) {
  const label = `Goal: ${conversation.goal?.condition ?? ""}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          className="flex size-3.5 items-center justify-center rounded-full bg-sidebar text-primary ring-1 ring-sidebar-border"
        >
          <TargetIcon className="size-2.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
