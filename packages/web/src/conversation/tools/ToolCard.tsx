import { Check, ChevronRight, CircleSlash, Loader2, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { isActive, type ToolStatus } from "../model/tool-state";

const STATUS_LABELS: Record<ToolStatus, string> = {
  pending: "Starting",
  running: "Running",
  done: "Done",
  error: "Failed",
  interrupted: "Interrupted",
};

function StatusIcon({ status }: { status: ToolStatus }) {
  const props = { className: "size-3.5", "aria-hidden": true } as const;
  if (isActive(status)) return <Loader2 {...props} className="size-3.5 animate-spin text-muted-foreground" />;
  if (status === "done") return <Check {...props} className="size-3.5 text-success" />;
  if (status === "error") return <X {...props} className="size-3.5 text-destructive" />;
  return <CircleSlash {...props} className="size-3.5 text-muted-foreground" />;
}

export interface ToolCardProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly status: ToolStatus;
  readonly badge?: ReactNode;
  readonly children?: ReactNode;
}

export function ToolCard({ icon, title, subtitle, status, badge, children }: ToolCardProps) {
  const [toggled, setToggled] = useState<boolean | undefined>(undefined);
  const open = toggled ?? isActive(status);
  return (
    <Collapsible
      open={open}
      onOpenChange={setToggled}
      data-tool-status={status}
      className="group/tool overflow-hidden rounded-lg border bg-card text-card-foreground"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/tool:rotate-90"
        />
        <span aria-hidden className="shrink-0 text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
        <span className="shrink-0 font-medium">{title}</span>
        {subtitle ? (
          <span className={cn("min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground")}>
            {subtitle}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {badge}
        <span className="flex shrink-0 items-center" role="status">
          <StatusIcon status={status} />
          <span className="sr-only">{STATUS_LABELS[status]}</span>
        </span>
      </CollapsibleTrigger>
      {children ? (
        <CollapsibleContent className="space-y-2 border-t p-3">{children}</CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}
