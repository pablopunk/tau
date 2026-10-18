import type { MonitorEventData } from "@tau/protocol";

/** Owner B (MVP8) builds this row; see MVP8.md section 6. The stub keeps the transcript from dropping the entry. */
export function MonitorEventRow({ data }: { data: MonitorEventData }) {
  return (
    <div data-testid="monitor-event" className="rounded-lg border bg-card px-3 py-2 text-sm">
      Monitor: {data.description}
    </div>
  );
}
