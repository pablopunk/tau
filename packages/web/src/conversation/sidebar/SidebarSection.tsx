import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function SidebarSection({
  title,
  count,
  defaultOpen = true,
  open,
  onOpenChange,
  actions,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  /** Controlled mode: expands automatically when content arrives (see callers). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Header-right buttons, e.g. the todos pencil. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      open={open}
      onOpenChange={onOpenChange}
      className="group/section rounded-lg border bg-card text-card-foreground"
    >
      <div className="flex items-center gap-1 px-1.5 py-1 text-xs text-muted-foreground">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5 py-1 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50">
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 transition-transform group-data-[state=open]/section:rotate-90"
          />
          <span className="flex-1 truncate font-medium uppercase tracking-wide">{title}</span>
          {count !== undefined ? <span className="tabular-nums">{count}</span> : null}
        </CollapsibleTrigger>
        {actions}
      </div>
      <CollapsibleContent className="border-t px-3 py-2.5">{children}</CollapsibleContent>
    </Collapsible>
  );
}
