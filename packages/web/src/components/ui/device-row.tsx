import { GlobeIcon, MonitorIcon, ServerIcon, SmartphoneIcon, TerminalIcon } from "lucide-react"
import type * as React from "react"
import { cn } from "@/lib/utils"

type DeviceKindName = "browser" | "phone" | "cli" | "node"

const KIND_ICONS = {
  browser: GlobeIcon,
  phone: SmartphoneIcon,
  cli: TerminalIcon,
  node: ServerIcon,
} satisfies Record<DeviceKindName, typeof MonitorIcon>

/** Rows inside one bordered container with dividers. */
function DeviceList({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul data-slot="device-list" className={cn("divide-y overflow-hidden rounded-lg border", className)} {...props} />
}

function DeviceRow({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="device-row" className={cn("flex items-center gap-3 px-3 py-2.5", className)} {...props} />
}

function DeviceKindIcon({ kind }: { kind: DeviceKindName }) {
  const Icon = KIND_ICONS[kind]
  return <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
}

function DeviceRowBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)} {...props} />
}

function DeviceRowActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex shrink-0 items-center gap-1", className)} {...props} />
}

export { DeviceKindIcon, DeviceList, DeviceRow, DeviceRowActions, DeviceRowBody }
