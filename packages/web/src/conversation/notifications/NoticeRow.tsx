import type { NoticeData } from "@tau/protocol";

export function NoticeRow({ data }: { data: NoticeData }) {
  return (
    <div data-testid="notice" className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
      {data.text}
    </div>
  );
}
