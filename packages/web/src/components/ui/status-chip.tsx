import { cva } from "class-variance-authority"
import type * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

const dotVariants = cva("size-1.5 shrink-0 rounded-full", {
  variants: {
    tone: {
      neutral: "bg-muted-foreground",
      busy: "bg-warning",
      success: "bg-green-500",
      error: "bg-destructive",
    },
  },
})

type StatusChipTone = "neutral" | "busy" | "success" | "error"

interface StatusChipProps extends Omit<React.ComponentProps<typeof Badge>, "variant"> {
  tone: StatusChipTone
  /** Shows a spinner instead of the dot. */
  loading?: boolean
}

/** A small outlined badge with a coloured dot: off, starting, online, reconnecting, error. */
function StatusChip({ tone, loading, className, children, ...props }: StatusChipProps) {
  return (
    <Badge data-slot="status-chip" data-tone={tone} variant="outline" className={cn(className)} {...props}>
      {loading ? <Spinner className="size-3" /> : <span aria-hidden className={dotVariants({ tone })} />}
      {children}
    </Badge>
  )
}

export { StatusChip }
export type { StatusChipProps, StatusChipTone }
