import * as React from "react"
import { cn } from "@/lib/utils"

/** The tick joining a `SidebarMenuSubItem` to its parent's guide line: `├` for a middle child, `└` for the last (the guide line is hidden below the tick). */
function TreeBranch({ last = false, className, ...props }: React.ComponentProps<"span"> & { last?: boolean }) {
  return (
    <span
      data-slot="tree-branch"
      data-last={last}
      aria-hidden
      className={cn("pointer-events-none absolute top-0 -left-2.5 h-full w-2.5", className)}
      {...props}
    >
      {last ? <span className="absolute top-1/2 -bottom-1 left-[-1px] w-px bg-sidebar" /> : null}
      <span className="absolute top-1/2 left-0 h-px w-full bg-sidebar-border" />
    </span>
  )
}

export { TreeBranch }
