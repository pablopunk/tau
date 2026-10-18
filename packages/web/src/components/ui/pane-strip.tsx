import { Plus, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface PaneTab {
  readonly kind: string;
  readonly id: string;
  readonly title: string;
  /** False for a tab that cannot be closed (the chat on a phone). Default true. */
  readonly closable?: boolean;
  /** The pane has ended: shown dimmed. */
  readonly ended?: boolean;
}

export interface PaneStripProps {
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

function StripTab({ tab, onClose }: { tab: PaneTab; onClose: PaneStripProps["onClose"] }) {
  return (
    <div className="group/pane-tab relative flex items-center">
      <TabsTrigger value={tab.id} data-ended={tab.ended || undefined} className={cn("pr-7", tab.ended && "italic opacity-70")}>
        {tab.title}
      </TabsTrigger>
      {tab.closable === false ? null : (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Close ${tab.title}`}
          className="absolute right-1 opacity-60 hover:opacity-100"
          onClick={() => onClose(tab)}
        >
          <X />
        </Button>
      )}
    </div>
  );
}

/** The open panes as tabs (`role=tablist`) over the body of the focused one. Generic: a pane has a `kind` and an `id`. */
export function PaneStrip({ tabs, focusedId, onFocus, onClose, onAdd, addLabel = "New pane", children, className, style }: PaneStripProps) {
  const focus = (id: string) => {
    const tab = tabs.find((candidate) => candidate.id === id);
    if (tab) onFocus(tab);
  };
  return (
    <div data-slot="pane-strip" style={style} className={cn("flex min-h-0 min-w-0 flex-col bg-background", className)}>
      <Tabs value={focusedId ?? ""} onValueChange={focus} className="shrink-0 gap-0 border-b px-2 py-1.5">
        <div className="flex items-center gap-1 overflow-x-auto">
          <TabsList variant="line" aria-label="Panes" className="h-8 w-auto gap-1 p-0">
            {tabs.map((tab) => (
              <StripTab key={tab.id} tab={tab} onClose={onClose} />
            ))}
          </TabsList>
          {onAdd ? (
            <Button variant="ghost" size="icon-sm" aria-label={addLabel} onClick={onAdd}>
              <Plus />
            </Button>
          ) : null}
        </div>
      </Tabs>
      {children ? <div className="min-h-0 flex-1">{children}</div> : null}
    </div>
  );
}
