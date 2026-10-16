import * as React from "react"
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

export const TAKEOVER_SCALE = 1.4

interface SidebarThreadRowProps {
  /** The link element that makes the row navigate, e.g. `<Link to=…/>`; the row fills its content. */
  link: React.ReactElement<{ children?: React.ReactNode }>
  title: string
  /** Usually a `BotAvatar`. */
  avatar: React.ReactNode
  /** The line above the title: in the Threads view a `ProjectIcon` and the project name. */
  context?: React.ReactNode
  /** The project icon that moves onto the avatar when the row is current. */
  takeover?: React.ReactNode
  /** Where the takeover icon comes from: the icon in the context line, or nowhere (it fades in over the avatar). */
  takeoverFrom?: "context" | "fade"
  /** The time of the last activity, usually a `RelativeTime`. */
  time: React.ReactNode
  /** Buttons that replace the time on hover or focus, and stay visible on touch screens. */
  actions?: React.ReactNode
  current?: boolean
  tooltip?: string
  /** Id for `useFlipList`. */
  flipId?: string
  className?: string
}

type Offset = { x: number; y: number }

const centerOf = (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })

function useTakeoverOffset(enabled: boolean) {
  const avatarRef = React.useRef<HTMLSpanElement>(null)
  const contextRef = React.useRef<HTMLSpanElement>(null)
  const [offset, setOffset] = React.useState<Offset>({ x: 0, y: 0 })
  React.useLayoutEffect(() => {
    const avatar = avatarRef.current
    const context = contextRef.current
    if (!enabled || !avatar || !context) return
    const measure = () => {
      const from = centerOf(context.getBoundingClientRect())
      const to = centerOf(avatar.getBoundingClientRect())
      setOffset((previous) =>
        previous.x === from.x - to.x && previous.y === from.y - to.y
          ? previous
          : { x: from.x - to.x, y: from.y - to.y }
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(avatar)
    observer.observe(context)
    return () => observer.disconnect()
  }, [enabled])
  return { avatarRef, contextRef, offset }
}

/** One thread in the sidebar, composed from the shadcn sidebar menu. Feature code adds no CSS of its own. */
function SidebarThreadRow({
  link,
  title,
  avatar,
  context,
  takeover,
  takeoverFrom = "context",
  time,
  actions,
  current = false,
  tooltip,
  flipId,
  className,
}: SidebarThreadRowProps) {
  const { avatarRef, contextRef, offset } = useTakeoverOffset(takeoverFrom === "context" && !!takeover)
  const taken = current && !!takeover
  const content = (
    <>
      <span ref={avatarRef} data-slot="thread-avatar" className="relative flex size-6 shrink-0 items-center justify-center">
        <span className={cn("flex transition-opacity duration-200", taken && "opacity-0")}>{avatar}</span>
        {takeover ? (
          <span
            data-slot="thread-takeover"
            data-current={taken}
            className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-[transform,opacity] duration-200 data-[current=true]:scale-[1.4] data-[current=true]:opacity-100"
            style={
              taken
                ? undefined
                : {
                    transform: `translate(${takeoverFrom === "context" ? offset.x : 0}px, ${takeoverFrom === "context" ? offset.y : 0}px)`,
                  }
            }
          >
            {takeover}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        {context ? (
          <span
            ref={contextRef}
            data-slot="thread-context"
            className={cn(
              "flex min-w-0 items-center gap-1 text-xs text-muted-foreground transition-opacity duration-200",
              taken && "opacity-0"
            )}
          >
            {context}
          </span>
        ) : null}
        <span data-slot="thread-title" className="truncate text-sm">
          {title}
        </span>
      </span>
      <span
        data-slot="thread-time"
        className={cn(
          "shrink-0 text-xs text-muted-foreground tabular-nums",
          actions && "md:group-focus-within/menu-item:hidden md:group-hover/menu-item:hidden"
        )}
      >
        {time}
      </span>
    </>
  )
  return (
    <SidebarMenuItem data-flip-id={flipId} data-current={current} className={className}>
      <SidebarMenuButton
        asChild
        isActive={current}
        size="lg"
        tooltip={tooltip}
        className={cn("h-auto min-h-14 gap-2 py-2", current && "shadow-[inset_2px_0_0_var(--sidebar-primary)]")}
      >
        {React.cloneElement(link, undefined, content)}
      </SidebarMenuButton>
      {actions ? (
        <div
          data-slot="thread-actions"
          className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5 md:hidden md:group-focus-within/menu-item:flex md:group-hover/menu-item:flex"
        >
          {actions}
        </div>
      ) : null}
    </SidebarMenuItem>
  )
}

export { SidebarThreadRow }
export type { SidebarThreadRowProps }
