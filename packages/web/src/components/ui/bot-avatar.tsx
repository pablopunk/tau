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

interface BotAvatarProps extends Omit<React.ComponentProps<"span">, "children"> {
  avatarIndex: number
  /** Hops and spins while the agent works. */
  working?: boolean
  paused?: boolean
  size?: number
  /** A status marker (a dot or icon) shown on the top left corner. */
  badge?: React.ReactNode
}

function BotAvatar({ avatarIndex, working = false, paused = false, size = 24, badge, className, ...props }: BotAvatarProps) {
  const reducedMotion = usePrefersReducedMotion()
  return (
    <span
      data-slot="bot-avatar"
      data-working={working}
      className={cn("relative inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
      {...props}
    >
      <BotAvatarCanvas
        {...botAvatarLook(avatarIndex)}
        size={size}
        state={working ? "working" : "default"}
        turn={working ? undefined : 0}
        paused={paused || reducedMotion}
        interactive={false}
        aria-hidden
      />
      {badge ? <span className="absolute -top-1 -left-1 flex">{badge}</span> : null}
    </span>
  )
}

export { BotAvatar }
export type { BotAvatarProps }
