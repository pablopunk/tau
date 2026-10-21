import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function SidebarSection({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="group/section rounded-lg border bg-card text-card-foreground"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded px-2.5 py-2 text-left text-xs font-medium text-muted-foreground outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 transition-transform group-data-[state=open]/section:rotate-90"
        />
        <span className="flex-1 truncate uppercase tracking-wide">{title}</span>
        {count !== undefined ? <span className="tabular-nums">{count}</span> : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-2.5">{children}</CollapsibleContent>
    </Collapsible>
  );
}
