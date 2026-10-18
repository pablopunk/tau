import { X } from "lucide-react"
import type * as React from "react"
import { StatusDot } from "@/components/ui/status-dot"
import { TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

interface ClosableTabProps extends Omit<React.ComponentProps<"div">, "title" | "onClick"> {
  /** The tab's value inside a `Tabs`. */
  value: string
  title: string
  /** Omitted means the tab cannot be closed. */
  onClose?: () => void
  /** The pane ended: muted text and a small status dot. */
  ended?: boolean
}

const CLOSE_VISIBILITY =
  "opacity-0 group-hover/closable-tab:opacity-100 group-focus-within/closable-tab:opacity-100 group-has-data-active/closable-tab:opacity-100 pointer-coarse:opacity-100"

/** A default-variant `TabsTrigger` with a small ghost close button inside its area. Close with the button, middle click, or Delete on the focused tab. */
function ClosableTab({ value, title, onClose, ended, className, ...props }: ClosableTabProps) {
  return (
    <div
      data-slot="closable-tab"
      data-ended={ended || undefined}
      className={cn("group/closable-tab relative flex h-full items-center", className)}
      onAuxClick={(event) => {
        if (event.button !== 1 || !onClose) return
        event.preventDefault()
        onClose()
      }}
      {...props}
    >
      <TabsTrigger
        value={value}
        data-ended={ended || undefined}
        onKeyDown={(event) => {
          if (event.key !== "Delete" || !onClose) return
          event.preventDefault()
          onClose()
        }}
        className={cn("px-2.5", onClose && "pr-7", ended && "text-muted-foreground")}
      >
        {ended ? <StatusDot status="error" aria-label="Ended" className="size-1.5" /> : null}
        {title}
      </TabsTrigger>
      {onClose ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Close ${title}`}
          onClick={onClose}
          className={cn(
            "absolute right-1.5 inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-opacity outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5",
            CLOSE_VISIBILITY,
          )}
        >
          <X />
        </button>
      ) : null}
    </div>
  )
}

export { ClosableTab }
export type { ClosableTabProps }
