import * as React from "react"
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
  /** A 17px `ProjectIcon`. On the current row it replaces the avatar: it slides there from the context line, or fades in when there is no context line. */
  projectIcon?: React.ReactNode
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
  /** A one-line row without the context line, for a child thread. */
  compact?: boolean
  /** Tree decoration drawn over the row, e.g. a `TreeBranch`, `TreeTrunk` or `TreeToggle`. */
  decoration?: React.ReactNode
}

const SHOW_ACTIONS = "md:group-hover/menu-item:flex md:group-focus-within/menu-item:flex md:group-data-[actions-open=true]/menu-item:flex"
const HIDE_TIME = "md:group-hover/menu-item:hidden md:group-focus-within/menu-item:hidden md:group-data-[actions-open=true]/menu-item:hidden"

const MOTION = "transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none"

const centerOf = (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })

function useProjectIconOffset(enabled: boolean) {
  const avatarRef = React.useRef<HTMLSpanElement>(null)
  const slotRef = React.useRef<HTMLSpanElement>(null)
  const [offset, setOffset] = React.useState({ x: 0, y: 0 })
  React.useLayoutEffect(() => {
    const avatar = avatarRef.current
    const slot = slotRef.current
    if (!enabled || !avatar || !slot) return
    const measure = () => {
      const from = centerOf(slot.getBoundingClientRect())
      const to = centerOf(avatar.getBoundingClientRect())
      const next = { x: to.x - from.x, y: to.y - from.y }
      setOffset((previous) => (previous.x === next.x && previous.y === next.y ? previous : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(avatar)
    observer.observe(slot)
    return () => observer.disconnect()
  }, [enabled])
  return { avatarRef, slotRef, offset }
}

/** One thread in the sidebar, composed from the shadcn sidebar menu. The right-hand slot swaps the time for the actions, so nothing overlaps the title. */
function SidebarThreadRow({
  link,
  title,
  avatar,
  context,
  projectIcon,
  time,
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
  const { avatarRef, slotRef, offset } = useProjectIconOffset(!!projectIcon && !!context)
  const Item = compact ? SidebarMenuSubItem : SidebarMenuItem
  const content = (
    <>
      <span ref={avatarRef} data-slot="thread-avatar" className={cn("relative flex shrink-0 items-center justify-center", compact ? "size-5" : "size-6")}>
        <span className={cn(MOTION, projectIcon && "group-data-[current=true]/menu-item:scale-80 group-data-[current=true]/menu-item:opacity-0")}>
          {avatar}
        </span>
        {projectIcon && !context ? (
          <span data-slot="thread-project-fade" className={cn(MOTION, "absolute opacity-0 scale-80 group-data-[current=true]/menu-item:scale-[1.4] group-data-[current=true]/menu-item:opacity-100")}>
            {projectIcon}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        {context ? (
          <span data-slot="thread-context" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {projectIcon ? (
              <span
                ref={slotRef}
                data-slot="thread-project-slot"
                className="z-10 flex size-[17px] shrink-0"
                style={{ "--project-offset-x": `${offset.x}px`, "--project-offset-y": `${offset.y}px` } as React.CSSProperties}
              >
                <span className={cn(MOTION, "flex group-data-[current=true]/menu-item:[transform:translate(var(--project-offset-x),var(--project-offset-y))_scale(1.4)]")}>
                  {projectIcon}
                </span>
              </span>
            ) : null}
            <span className={cn("truncate", MOTION, projectIcon && "group-data-[current=true]/menu-item:-translate-x-[21px]")}>{context}</span>
          </span>
        ) : null}
        <span data-slot="thread-title" className={cn("line-clamp-2 break-words", "text-sm font-normal text-foreground/80 group-data-[current=true]/menu-item:font-semibold group-data-[current=true]/menu-item:text-foreground")}>
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
        className={cn("h-auto gap-2 pr-14 [&>span:last-child]:overflow-visible [&>span:last-child]:whitespace-normal!", compact ? "min-h-9 py-1" : "min-h-14 py-2")}
      >
        {React.cloneElement(link, undefined, content)}
      </SidebarMenuButton>
      <div
        data-slot="thread-aside"
        className={cn("pointer-events-none absolute right-2 flex h-6 items-center justify-end", compact ? "top-1.5" : "top-2")}
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
      {decoration}
    </Item>
  )
}

export { SidebarThreadRow }
export type { SidebarThreadRowProps }
