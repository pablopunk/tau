import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface ContextMeterProps {
  used: number
  total: number
  /** Tooltip text, e.g. "42k of 200k tokens · 21%". */
  label?: string
  className?: string
}

const SIZE = 16
const STROKE = 2
const RADIUS = (SIZE - STROKE) / 2
const MIN_ROUND_PERCENT = 5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function percentOf(used: number, total: number) {
  return Math.min(100, Math.max(0, (used / total) * 100))
}

function progressColor(percent: number) {
  if (percent >= 95) return "text-destructive"
  if (percent >= 80) return "text-warning"
  return "text-primary"
}

/** A small ring showing how much of a budget is used; turns warning at 80% and destructive at 95%. */
function ContextMeter({ used, total, label, className }: ContextMeterProps) {
  if (total <= 0 || used <= 0) return null
  const percent = percentOf(used, total)
  const text = label ?? `${Math.round(percent)}%`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="meter"
          aria-label={text}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.min(Math.max(used, 0), total)}
          tabIndex={0}
          data-slot="context-meter"
          className={cn("inline-flex shrink-0 items-center gap-1 rounded-full text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring", progressColor(percent), className)}
        >
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-4 shrink-0 -rotate-90" aria-hidden="true">
            <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-muted-foreground/30" />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap={percent < MIN_ROUND_PERCENT ? "butt" : "round"}
              stroke="currentColor"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
            />
          </svg>
          <span>{Math.round(percent)}%</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  )
}

export { ContextMeter }
export type { ContextMeterProps }
