import type * as React from "react"
import { cn } from "@/lib/utils"

/** Text painted with the tau logo gradient (gold, coral, blue). */
function BrandText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="brand-text"
      className={cn("bg-brand-gradient bg-clip-text text-transparent", className)}
      {...props}
    />
  )
}

export { BrandText }
