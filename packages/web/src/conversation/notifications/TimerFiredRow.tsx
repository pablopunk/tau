import type { TimerFiredData } from "@tau/protocol";
import { TimerIcon } from "lucide-react";

const headline = (data: TimerFiredData): string =>
  data.kind === "repeat" ? `Repeat fired (${data.firedCount + 1})` : "Wake-up fired";

export function TimerFiredRow({ data }: { data: TimerFiredData }) {
  return (
    <div
      data-testid="timer-fired"
      className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-sm"
    >
      <TimerIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">
          {headline(data)}
          {data.source === "loop" ? " · /loop" : ""}
          {data.reason ? ` · ${data.reason}` : ""}
        </span>
        <span className="whitespace-pre-wrap break-words">{data.prompt}</span>
      </div>
    </div>
  );
}
