import * as React from "react"
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"

interface SidebarThreadRowProps extends Omit<React.ComponentProps<"li">, "title" | "children"> {
  /** The link element that makes the row navigate, e.g. `<Link to=…/>`; the row fills its content. */
  link: React.ReactElement<{ children?: React.ReactNode }>
  title: string
  /** Usually a `BotAvatar`. */
  avatar: React.ReactNode
  /** The line above the title: a `ProjectIcon` and the project name. */
  context?: React.ReactNode
  /** The time of the last activity, usually a `RelativeTime`. */
  time: React.ReactNode
  /** Buttons that take the time's place on hover, focus or while a menu is open; always shown on touch screens. */
  actions?: React.ReactNode
  /** Keeps the actions visible, e.g. while their menu is open. */
  actionsOpen?: boolean
  current?: boolean
  tooltip?: string
  /** Id for `useFlipList`. */
  flipId?: string
}

const SHOW_ACTIONS = "md:group-hover/menu-item:flex md:group-focus-within/menu-item:flex md:group-data-[actions-open=true]/menu-item:flex"
const HIDE_TIME = "md:group-hover/menu-item:hidden md:group-focus-within/menu-item:hidden md:group-data-[actions-open=true]/menu-item:hidden"

/** One thread in the sidebar, composed from the shadcn sidebar menu. The right-hand slot swaps the time for the actions, so nothing overlaps the title. */
function SidebarThreadRow({
  link,
  title,
  avatar,
  context,
  time,
  actions,
  actionsOpen = false,
  current = false,
  tooltip,
  flipId,
  ...props
}: SidebarThreadRowProps) {
  const content = (
    <>
      <span data-slot="thread-avatar" className="flex size-6 shrink-0 items-center justify-center">
        {avatar}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        {context ? (
          <span data-slot="thread-context" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {context}
          </span>
        ) : null}
        <span data-slot="thread-title" className="truncate text-sm">
          {title}
        </span>
      </span>
    </>
  )
  return (
    <SidebarMenuItem
      data-flip-id={flipId}
      data-current={current}
      data-actions-open={actionsOpen}
      {...props}
    >
      <SidebarMenuButton
        asChild
        isActive={current}
        size="lg"
        tooltip={tooltip}
        className="h-auto min-h-14 gap-2 py-2 pr-14"
      >
        {React.cloneElement(link, undefined, content)}
      </SidebarMenuButton>
      <div
        data-slot="thread-aside"
        className="pointer-events-none absolute top-2 right-2 flex h-6 items-center justify-end"
      >
        <span
          data-slot="thread-time"
          className={`text-xs text-muted-foreground tabular-nums ${actions ? `hidden md:inline ${HIDE_TIME}` : ""}`}
        >
          {time}
        </span>
        {actions ? (
          <div data-slot="thread-actions" className={`pointer-events-auto flex items-center gap-0.5 md:hidden ${SHOW_ACTIONS}`}>
            {actions}
          </div>
        ) : null}
      </div>
    </SidebarMenuItem>
  )
}

export { SidebarThreadRow }
export type { SidebarThreadRowProps }
