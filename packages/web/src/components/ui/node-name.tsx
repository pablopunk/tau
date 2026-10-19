import type * as React from "react"
import { cn } from "@/lib/utils"

/** A node's name; the local node (the one this browser talks to) gets a small dim "local" after it. */
function NodeName({
  name,
  local = false,
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & { name: string; local?: boolean }) {
  return (
    <span data-slot="node-name" className={cn("flex min-w-0 items-baseline gap-1.5", className)} {...props}>
      <span className="truncate">{name}</span>
      {local ? <span className="shrink-0 text-xs font-normal text-muted-foreground">local</span> : null}
    </span>
  )
}

export { NodeName }
