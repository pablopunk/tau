import type { Timer } from "@tau/protocol";
import { Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { firedLabel, scheduleLabel, untilLabel } from "./format";

export function TimerRow({
  timer,
  now,
  onDelete,
}: {
  timer: Timer;
  now: number;
  onDelete: (timer: Timer) => void;
}) {
  return (
    <li data-testid="timer-row" className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="line-clamp-2 break-words text-sm" title={timer.prompt}>
          {timer.prompt}
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span>{scheduleLabel(timer)}</span>
          <span>· next {untilLabel(timer.nextAt, now)}</span>
          <span>· {firedLabel(timer.firedCount)}</span>
          {timer.source === "loop" ? (
            <Badge variant="secondary" className="h-4">
              /loop
            </Badge>
          ) : null}
        </p>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Delete timer: ${timer.prompt}`}
            onClick={() => onDelete(timer)}
          >
            <Trash2Icon />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Delete timer</TooltipContent>
      </Tooltip>
    </li>
  );
}
