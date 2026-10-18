import type { ProcessExitData } from "@tau/protocol";

/** Owner B (MVP8) builds this row; see MVP8.md section 6. The stub keeps the transcript from dropping the entry. */
export function ProcessExitRow({ data }: { data: ProcessExitData }) {
  return (
    <div data-testid="process-exit" className="rounded-lg border bg-card px-3 py-2 text-sm">
      Process exited: {data.name}
    </div>
  );
}
