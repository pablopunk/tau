import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export const COLLAPSED_LINE_COUNT = 5;

const Lines = ({ lines }: { lines: readonly string[] }) => (
  <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap">{lines.join("\n")}</pre>
);

/** Output lines in a `<pre>`; more than 5 collapse behind the summary. */
export function LogLines({ lines, summary }: { lines: readonly string[]; summary: ReactNode }) {
  if (lines.length <= COLLAPSED_LINE_COUNT) {
    return (
      <div className="space-y-1 px-3 py-2">
        <div>{summary}</div>
        {lines.length > 0 ? <Lines lines={lines} /> : null}
      </div>
    );
  }
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left">
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90"
        />
        {summary}
        <span className="text-xs text-muted-foreground">{lines.length} lines</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-2">
        <Lines lines={lines} />
      </CollapsibleContent>
    </Collapsible>
  );
}
