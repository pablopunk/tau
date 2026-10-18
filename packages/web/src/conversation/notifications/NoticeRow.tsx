import type { NoticeData } from "@tau/protocol";

/** Owner B (MVP8) builds this row; see MVP8.md section 6. The stub keeps the transcript from dropping the entry. */
export function NoticeRow({ data }: { data: NoticeData }) {
  return (
    <div data-testid="notice" className="rounded-lg border bg-card px-3 py-2 text-sm">
      {data.text}
    </div>
  );
}
