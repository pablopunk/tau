import type { TimerFiredData } from "@tau/protocol";

/** Owner C (MVP8) builds this row; see MVP8.md section 6. The stub keeps the transcript from dropping the entry. */
export function TimerFiredRow({ data }: { data: TimerFiredData }) {
  return (
    <div data-testid="timer-fired" className="rounded-lg border bg-card px-3 py-2 text-sm">
      Timer fired: {data.prompt}
    </div>
  );
}
