import { BotAvatar as BotAvatarCanvas, botAvatarTypes } from "bot-avatars"
import type * as React from "react"
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion"
import { cn } from "@/lib/utils"

const GOLDEN_ANGLE = 137.508
const GOLDEN_RATIO = 0.618033988749895

/** The same thread always gets the same bot: type, colour and blink timing all follow the index. */
export function botAvatarLook(index: number) {
  return {
    type: botAvatarTypes[index % botAvatarTypes.length],
    color: `hsl(${(index * GOLDEN_ANGLE) % 360}, 72%, 58%)`,
    seed: (index * GOLDEN_RATIO) % 1,
  }
}

/** bot-avatars draws the resting bot above its box center (it keeps headroom for the hop); measured at about a fifth of the size. */
const spriteCenteringOffset = (size: number) => Math.round(size * 0.21)

interface BotAvatarProps extends Omit<React.ComponentProps<"span">, "children"> {
  avatarIndex: number
  /** The only time the avatar moves: it hops and spins while the agent works, otherwise it is still. */
  working?: boolean
  size?: number
  /** A status marker (a dot or icon) shown on the top left corner. */
  badge?: React.ReactNode
  /** A marker about where the thread came from (e.g. a fork), shown on the bottom left corner. */
  originBadge?: React.ReactNode
  /** A marker for an active goal, shown on the top right corner. */
  goalBadge?: React.ReactNode
}

function BotAvatar({ avatarIndex, working = false, size = 24, badge, originBadge, goalBadge, className, ...props }: BotAvatarProps) {
  const reducedMotion = usePrefersReducedMotion()
  return (
    <span
      data-slot="bot-avatar"
      data-working={working}
      className={cn("relative inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
      {...props}
    >
      <span className="flex" style={{ transform: `translateY(${spriteCenteringOffset(size)}px)` }}>
        <BotAvatarCanvas
          {...botAvatarLook(avatarIndex)}
          size={size}
          state={working ? "working" : "default"}
          turn={working ? undefined : 0}
          paused={!working || reducedMotion}
          interactive={false}
          aria-hidden
        />
      </span>
      {badge ? <span className="absolute -top-1 -left-1 flex">{badge}</span> : null}
      {goalBadge ? <span className="absolute -top-1 -right-1 flex">{goalBadge}</span> : null}
      {originBadge ? <span className="absolute -bottom-1 -left-1 flex">{originBadge}</span> : null}
    </span>
  )
}

export { BotAvatar }
export type { BotAvatarProps }
