import { CircleCheckIcon } from "lucide-react"
import * as React from "react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

const COLUMNS = "sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_12.5rem]"

/** One bordered container with dividers. Rows share three aligned columns: provider, status, actions. */
function ProviderList({ className, children, ...props }: React.ComponentProps<"ul">) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div
        aria-hidden
        className={cn("hidden gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid", COLUMNS)}
      >
        <span>Provider</span>
        <span>Status</span>
        <span className="text-right">Actions</span>
      </div>
      <ul data-slot="provider-list" className={cn("divide-y", className)} {...props}>
        {children}
      </ul>
    </div>
  )
}

function ProviderListRow({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="provider-list-row"
      className={cn("grid grid-cols-1 items-center gap-x-3 gap-y-2 px-3 py-3", COLUMNS, className)}
      {...props}
    />
  )
}

/** The provider name; a green check follows it when the provider is connected. */
function ProviderListName({ name, connected = false }: { name: string; connected?: boolean }) {
  return (
    <div data-slot="provider-list-name" className="flex min-w-0 items-center gap-1.5">
      <span className="block truncate text-sm font-medium">{name}</span>
      {connected ? (
        <CircleCheckIcon role="img" aria-label="Connected" className="size-4 shrink-0 text-green-500" />
      ) : null}
    </div>
  )
}

/** A status slot: the badge (if any) truncates and shows in full in a tooltip; the note sits under it. */
function ProviderListStatus({
  label,
  note,
  children,
}: {
  label: string
  note?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div data-slot="provider-list-status" className="flex min-w-0 flex-col items-start gap-1">
      {children ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex min-w-0 max-w-full">{children}</span>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
      {note && children ? <span className="text-xs/relaxed text-muted-foreground">{note}</span> : null}
      {note && !children ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs/relaxed text-muted-foreground">{note}</span>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </div>
  )
}

function ProviderListActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="provider-list-actions"
      className={cn("flex items-center gap-1.5 sm:justify-end", className)}
      {...props}
    />
  )
}

/** Full-width content under a row, such as a form or a confirmation. */
function ProviderListDetail({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="provider-list-detail" className={cn("col-span-full", className)} {...props} />
}

export { ProviderList, ProviderListActions, ProviderListDetail, ProviderListName, ProviderListRow, ProviderListStatus }
