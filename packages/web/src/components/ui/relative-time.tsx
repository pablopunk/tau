import { useEffect, useState } from "react"
import { MorphText } from "@/components/ui/morph-text"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const REFRESH_MS = 30_000

/** `now`, `5m`, `3h`, `2d`, then `2w` and `1y`. */
export function formatRelativeTime(at: number, now: number): string {
  const elapsed = Math.max(0, now - at)
  if (elapsed < MINUTE) return "now"
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`
  if (elapsed < 52 * WEEK) return `${Math.floor(elapsed / WEEK)}w`
  return `${Math.floor(elapsed / (52 * WEEK))}y`
}

interface RelativeTimeProps extends Omit<React.ComponentProps<"time">, "children" | "dateTime"> {
  at: number
  /** Fixed clock for tests and stories; by default the time follows the real clock. */
  now?: number
  /** Morph the text when it changes. Off by default: lists can have many rows. */
  animate?: boolean
}

function RelativeTime({ at, now, animate, ...props }: RelativeTimeProps) {
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    if (now !== undefined) return
    const timer = setInterval(() => setTick(Date.now()), REFRESH_MS)
    return () => clearInterval(timer)
  }, [now])
  const text = formatRelativeTime(at, now ?? tick)
  return (
    <time data-slot="relative-time" dateTime={new Date(at).toISOString()} {...props}>
      {animate ? <MorphText>{text}</MorphText> : text}
    </time>
  )
}

export { RelativeTime }
export type { RelativeTimeProps }
