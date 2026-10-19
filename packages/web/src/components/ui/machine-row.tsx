import { cva } from "class-variance-authority"
import type * as React from "react"
import { StatusChip } from "@/components/ui/status-chip"
import { cn } from "@/lib/utils"

type MachineDotStatus = "online" | "reconnecting" | "offline" | "update-required"

const dotVariants = cva("inline-block size-2 shrink-0 rounded-full", {
  variants: {
    status: {
      online: "bg-green-500",
      reconnecting: "animate-pulse bg-warning",
      offline: "bg-muted-foreground/50",
      "update-required": "bg-warning",
    },
  },
})

const DOT_LABELS: Record<MachineDotStatus, string> = {
  online: "Online",
  reconnecting: "Reconnecting",
  offline: "Offline",
  "update-required": "Update required",
}

/** The online dot of a machine: green online, pulsing reconnecting, grey offline, amber update required. */
function MachineDot({
  status,
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & { status: MachineDotStatus }) {
  return (
    <span
      data-slot="machine-dot"
      data-status={status}
      role="img"
      aria-label={DOT_LABELS[status]}
      className={cn(dotVariants({ status }), className)}
      {...props}
    />
  )
}

/** Rows inside one bordered container with dividers. */
function MachineList({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="machine-list"
      className={cn("divide-y overflow-hidden rounded-lg border", className)}
      {...props}
    />
  )
}

function MachineRow({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="machine-row"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5", className)}
      {...props}
    />
  )
}

function MachineRowBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex min-w-48 flex-1 flex-col gap-0.5", className)} {...props} />
}

function MachineRowActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex shrink-0 flex-wrap items-center justify-end gap-1 max-sm:w-full max-sm:justify-start", className)} {...props} />
}

type MachineVersionState = "behind" | "current" | "unknown"

/** The optional version slot of a row: the version and a chip, behind (with the latest), up to date, or unknown. */
function MachineRowVersion({
  version,
  state,
  latest,
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  version: string
  state: MachineVersionState
  latest?: string | null
}) {
  return (
    <span
      data-slot="machine-row-version"
      className={cn("flex shrink-0 items-center gap-2 text-xs text-muted-foreground", className)}
      {...props}
    >
      {version ? <span className="font-mono">{version}</span> : null}
      {state === "behind" ? (
        <StatusChip tone="busy">Behind, latest {latest}</StatusChip>
      ) : state === "current" ? (
        <StatusChip tone="success">Up to date</StatusChip>
      ) : (
        <StatusChip tone="neutral">Version unknown</StatusChip>
      )}
    </span>
  )
}

export { MachineDot, MachineList, MachineRow, MachineRowActions, MachineRowBody, MachineRowVersion }
export type { MachineDotStatus, MachineVersionState }
