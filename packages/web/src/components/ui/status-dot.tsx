import { cva } from "class-variance-authority"
import type * as React from "react"
import { cn } from "@/lib/utils"

const statusDotVariants = cva("inline-block size-2 shrink-0 rounded-full", {
  variants: {
    status: {
      running: "animate-pulse bg-warning",
      error: "bg-destructive",
      unseen: "bg-primary",
    },
  },
})

const STATUS_LABELS = {
  running: "Running",
  error: "Failed",
  unseen: "New activity",
} as const

type StatusDotStatus = keyof typeof STATUS_LABELS

type StatusDotProps = Omit<React.ComponentProps<"span">, "children"> & { status: StatusDotStatus }

function StatusDot({ status, className, ...props }: StatusDotProps) {
  return (
    <span
      data-slot="status-dot"
      data-status={status}
      role="img"
      aria-label={STATUS_LABELS[status]}
      className={cn(statusDotVariants({ status }), className)}
      {...props}
    />
  )
}

export { StatusDot }
export type { StatusDotProps, StatusDotStatus }
