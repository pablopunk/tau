import type { GoalVerdict, GoalVerdictData } from "@tau/protocol";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const LABELS: Record<GoalVerdict, string> = {
  not_met: "not met",
  met: "met",
  impossible: "impossible",
};

/** One goal check in the transcript: "Goal check: not met — reason", with the whole reason one click away. */
export function GoalVerdictRow({ data }: { data: GoalVerdictData }) {
  return (
    <Collapsible data-testid="goal-verdict" className="rounded-lg border bg-card text-sm">
      <CollapsibleTrigger className="group flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left">
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90"
        />
        <span className="min-w-0 truncate">
          Goal check: <span className="font-medium">{LABELS[data.verdict]}</span> — {data.reason}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-2 whitespace-pre-wrap">
        {data.reason}
      </CollapsibleContent>
    </Collapsible>
  );
}
