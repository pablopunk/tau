import { Plus } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ClosableTab } from "@/components/ui/closable-tab";
import { Tabs, TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface PaneTab {
  readonly kind: string;
  readonly id: string;
  readonly title: string;
  /** False for a tab that cannot be closed (the chat on a phone). Default true. */
  readonly closable?: boolean;
  /** The pane has ended: shown with a status dot. */
  readonly ended?: boolean;
}

export interface PaneStripProps {
  /** Shown before the tabs, e.g. a sidebar toggle when the chat pane is hidden. */
  readonly leading?: ReactNode;
  readonly tabs: readonly PaneTab[];
  readonly focusedId: string | undefined;
  readonly onFocus: (tab: PaneTab) => void;
  readonly onClose: (tab: PaneTab) => void;
  /** Adds a pane; omitted means no add button. */
  readonly onAdd?: () => void;
  readonly addLabel?: string;
  /** The body of the focused pane. */
  readonly children?: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** The open panes as tabs (`role=tablist`) over the body of the focused one. Generic: a pane has a `kind` and an `id`. */
export function PaneStrip({ leading, tabs, focusedId, onFocus, onClose, onAdd, addLabel = "New pane", children, className, style }: PaneStripProps) {
  const focus = (id: string) => {
    const tab = tabs.find((candidate) => candidate.id === id);
    if (tab) onFocus(tab);
  };
  return (
    <div data-slot="pane-strip" style={style} className={cn("flex min-h-0 min-w-0 flex-col bg-background", className)}>
      <Tabs value={focusedId ?? ""} onValueChange={focus} className="shrink-0 gap-0 border-b px-2 py-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          {leading}
          <TabsList aria-label="Panes" className="w-auto flex-none">
            {tabs.map((tab) => (
              <ClosableTab
                key={tab.id}
                value={tab.id}
                title={tab.title}
                ended={tab.ended}
                onClose={tab.closable === false ? undefined : () => onClose(tab)}
              />
            ))}
          </TabsList>
          {onAdd ? (
            <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label={addLabel} onClick={onAdd}>
              <Plus />
            </Button>
          ) : null}
        </div>
      </Tabs>
      {children ? <div className="min-h-0 flex-1">{children}</div> : null}
    </div>
  );
}
