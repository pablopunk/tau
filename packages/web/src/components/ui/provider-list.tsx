import * as React from "react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

const COLUMNS = "sm:grid-cols-[minmax(0,1fr)_10rem_12.5rem]"

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

function ProviderListName({ name, description }: { name: string; description?: React.ReactNode }) {
  return (
    <div data-slot="provider-list-name" className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-sm font-medium">{name}</span>
      {description ? <span className="text-xs/relaxed text-muted-foreground">{description}</span> : null}
    </div>
  )
}

/** A status slot whose text truncates and shows in full in a tooltip. */
function ProviderListStatus({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div data-slot="provider-list-status" className="flex min-w-0 items-center">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex min-w-0 max-w-full">{children}</span>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
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
