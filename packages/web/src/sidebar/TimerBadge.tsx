import type { ConversationSummary } from "@tau/protocol";
import { ClockIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { nextWakeupLabel } from "@/timers/format";

export const hasTimer = (conversation: ConversationSummary): boolean => conversation.timers > 0;

export function TimerBadge({ conversation }: { conversation: ConversationSummary }) {
  const label = nextWakeupLabel(conversation.nextTimerAt, Date.now());
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          className="flex size-3.5 items-center justify-center rounded-full bg-sidebar text-muted-foreground ring-1 ring-sidebar-border"
        >
          <ClockIcon className="size-2.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
