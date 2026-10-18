import type { MonitorEventData } from "@tau/protocol";
import { LogLines } from "./LogLines";

export function monitorEndLabel(ended: NonNullable<MonitorEventData["ended"]>): string {
  if (ended === "timeout") return "ended: timeout";
  return `ended: exit ${ended.exitCode ?? "none"}`;
}

const droppedLabel = (dropped: number) => (dropped > 0 ? ` (+${dropped} dropped)` : "");

export function MonitorEventRow({ data }: { data: MonitorEventData }) {
  const summary = (
    <span className="min-w-0 truncate">
      Monitor <span className="font-medium">{data.description}</span>
      {data.lines.length === 0 && data.dropped === 0 && !data.ended ? ": no output" : null}
      {droppedLabel(data.dropped)}
      {data.ended ? `, ${monitorEndLabel(data.ended)}` : null}
    </span>
  );
  return (
    <div data-testid="monitor-event" className="rounded-lg border bg-card text-sm">
      <LogLines lines={data.lines} summary={summary} />
    </div>
  );
}
