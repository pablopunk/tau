import type { BangData } from "@tau/protocol";
import { Terminal } from "lucide-react";

/** Display-only row for a `!` command: admitted while busy, never sent to the model. */
export function BangRow({ data }: { data: BangData }) {
  return (
    <div
      data-testid="bang"
      className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground"
    >
      <Terminal aria-hidden className="size-4 shrink-0" />
      <code className="truncate font-mono">{data.command}</code>
    </div>
  );
}
