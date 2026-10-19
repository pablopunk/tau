import type * as React from "react"
import { cn } from "@/lib/utils"

/** The tau mark, the same image as the favicon. */
function TauLogo({ className, ...props }: Omit<React.ComponentProps<"img">, "src" | "alt">) {
  return (
    <img
      data-slot="tau-logo"
      src="/favicon.svg"
      alt="tau"
      draggable={false}
      className={cn("size-7 shrink-0 select-none", className)}
      {...props}
    />
  )
}

export { TauLogo }
