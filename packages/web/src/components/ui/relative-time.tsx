import { useEffect, useState } from "react"

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
}

function RelativeTime({ at, now, ...props }: RelativeTimeProps) {
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    if (now !== undefined) return
    const timer = setInterval(() => setTick(Date.now()), REFRESH_MS)
    return () => clearInterval(timer)
  }, [now])
  return (
    <time data-slot="relative-time" dateTime={new Date(at).toISOString()} {...props}>
      {formatRelativeTime(at, now ?? tick)}
    </time>
  )
}

export { RelativeTime }
export type { RelativeTimeProps }
