import type { GoalVerdictData } from "@tau/protocol";

/** Owner D (MVP8) builds this row; see MVP8.md section 6 and 7. The stub keeps the transcript from dropping the entry. */
export function GoalVerdictRow({ data }: { data: GoalVerdictData }) {
  return (
    <div data-testid="goal-verdict" className="rounded-lg border bg-card px-3 py-2 text-sm">
      Goal check: {data.verdict} — {data.reason}
    </div>
  );
}
