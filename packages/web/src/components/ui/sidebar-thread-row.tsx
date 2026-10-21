import * as React from "react"
import { motion, snappy } from "@/components/ui/motion"
import { SidebarMenuButton, SidebarMenuItem, SidebarMenuSubItem } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

interface SidebarThreadRowProps extends Omit<React.ComponentProps<"li">, "title" | "children"> {
  /** The link element that makes the row navigate, e.g. `<Link to=…/>`; the row fills its content. */
  link: React.ReactElement<{ children?: React.ReactNode }>
  title: string
  /** Usually a `BotAvatar`. */
  avatar: React.ReactNode
  /** The text of the line above the title, e.g. the project name. */
  context?: React.ReactNode
  /** A 17px `ProjectIcon`. On the current row it flies onto the avatar spot via a shared-element move, or fades in when there is no context line. */
  projectIcon?: React.ReactNode
  /** The time of the last activity, usually a `RelativeTime`. */
  time: React.ReactNode
  /** A worktree state mirror shown at the row's bottom right, e.g. a `WorktreeIndicator`. */
  worktree?: React.ReactNode
  /** Buttons that take the time's place on hover, focus or while a menu is open; always shown on touch screens. */
  actions?: React.ReactNode
  /** Keeps the actions visible, e.g. while their menu is open. */
  actionsOpen?: boolean
  current?: boolean
  tooltip?: string
  /** Id for `useFlipList`. Also scopes the project icon's shared-element id. */
  flipId?: string
  /** A one-line row without the context line, for a child thread. */
  compact?: boolean
  /** Tree decoration drawn over the row, e.g. a `TreeBranch`. */
  decoration?: React.ReactNode
}

const SHOW_ACTIONS = "md:group-hover/menu-item:flex md:group-focus-within/menu-item:flex md:group-data-[actions-open=true]/menu-item:flex"
const HIDE_TIME = "md:group-hover/menu-item:hidden md:group-focus-within/menu-item:hidden md:group-data-[actions-open=true]/menu-item:hidden"

const MOTION = "transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none"

/** One thread in the sidebar, composed from the shadcn sidebar menu. The right-hand slot swaps the time for the actions, so nothing overlaps the title. */
function SidebarThreadRow({
  link,
  title,
  avatar,
  context,
  projectIcon,
  time,
  worktree,
  actions,
  actionsOpen = false,
  current = false,
  tooltip,
  flipId,
  className,
  compact = false,
  decoration,
  ...props
}: SidebarThreadRowProps) {
  const Item = compact ? SidebarMenuSubItem : SidebarMenuItem
  // Shared-element id: the icon is rendered either in the context slot (idle row)
  // or over the avatar (current row). Motion animates it between the two spots.
  const iconLayoutId = flipId ? `thread-project-${flipId}` : undefined
  const content = (
    <>
      <span
        data-slot="thread-avatar"
        className={cn("relative flex shrink-0 items-center justify-center", compact ? "size-5" : "size-6")}
      >
        <span className={cn(MOTION, projectIcon && "group-data-[current=true]/menu-item:scale-80 group-data-[current=true]/menu-item:opacity-0")}>
          {avatar}
        </span>
        {projectIcon && current ? (
          <motion.span
            data-slot="thread-project-fade"
            layoutId={iconLayoutId}
            initial={iconLayoutId ? false : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1.4 }}
            transition={snappy}
            className="absolute"
          >
            {projectIcon}
          </motion.span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        {context ? (
          <span data-slot="thread-context" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {projectIcon ? (
              <span data-slot="thread-project-slot" className="z-10 flex size-[17px] shrink-0">
                {current ? null : (
                  <motion.span layoutId={iconLayoutId} transition={snappy} className="flex">
                    {projectIcon}
                  </motion.span>
                )}
              </span>
            ) : null}
            <span className={cn("truncate", MOTION, projectIcon && "group-data-[current=true]/menu-item:-translate-x-[21px]", "group-data-[current=true]/menu-item:font-semibold")}>{context}</span>
          </span>
        ) : null}
        <span data-slot="thread-title" className={cn(compact ? "truncate" : "line-clamp-2 break-words", "text-sm font-normal text-foreground/80 group-data-[current=true]/menu-item:text-foreground")}>
          {title}
        </span>
      </span>
    </>
  )
  return (
    <Item
      className={cn(compact && "group/menu-item", className)}
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
        className={cn("h-auto gap-2 [&>span:last-child]:overflow-visible [&>span:last-child]:whitespace-normal!", actions ? "pr-14 max-md:pointer-coarse:pr-28" : "pr-2", compact ? "min-h-8 py-1 pointer-coarse:min-h-12" : "min-h-14 py-2", worktree && !compact ? "pointer-coarse:min-h-20" : undefined)}
      >
        {React.cloneElement(link, undefined, content)}
      </SidebarMenuButton>
      <div
        data-slot="thread-aside"
        className={cn("pointer-events-none absolute right-2 flex h-6 items-center justify-end", compact ? "top-1.5" : "top-2", worktree && !compact ? "pointer-coarse:top-2 pointer-coarse:h-11" : "pointer-coarse:top-1/2 pointer-coarse:h-11 pointer-coarse:-translate-y-1/2")}
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
      {worktree && !compact ? (
        <div
          data-slot="thread-worktree"
          className="pointer-events-auto absolute right-2 bottom-1.5 flex h-4 items-center justify-end"
        >
          {worktree}
        </div>
      ) : null}
      {decoration}
    </Item>
  )
}

export { SidebarThreadRow }
export type { SidebarThreadRowProps }
