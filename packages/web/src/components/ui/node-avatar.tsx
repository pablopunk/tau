import type * as React from "react"
import { cn } from "@/lib/utils"
import { type NodeDotStatus, NodeDot } from "./node-row"
import { OsIcon, osLabelOf } from "./os-icon"

const STATUS_WORDS: Record<NodeDotStatus, string> = {
  online: "online",
  reconnecting: "reconnecting",
  offline: "offline",
  "update-required": "update required",
}

/** The OS icon of a node with its status dot as a badge in the bottom-right corner. */
function NodeAvatar({
  os,
  status,
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & { os: string | undefined; status: NodeDotStatus }) {
  return (
    <span
      data-slot="node-avatar"
      data-status={status}
      role="img"
      aria-label={`${osLabelOf(os)}, ${STATUS_WORDS[status]}`}
      className={cn("relative inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground", className)}
      {...props}
    >
      <OsIcon os={os} className="size-full" />
      <NodeDot
        status={status}
        aria-hidden
        role="presentation"
        className="absolute -right-1 -bottom-1 size-1.5 ring-2 ring-background"
      />
    </span>
  )
}

export { NodeAvatar }
