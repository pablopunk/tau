import * as React from "react"
import { TextMorph } from "torph/react"
import { cn } from "@/lib/utils"

const DEFAULT_DURATION_MS = 400

interface MorphTextProps extends Omit<React.ComponentProps<"span">, "children"> {
  children: string | number
  duration?: number
  /** Renders a plain span, e.g. for lists with many rows. */
  disabled?: boolean
}

/** Short text that morphs between values: a status, a count, a time. Not for streamed or wrapping text. */
function MorphText({ children, duration = DEFAULT_DURATION_MS, disabled, className, ...props }: MorphTextProps) {
  if (disabled) {
    return (
      <span data-slot="morph-text" className={className} {...props}>
        {children}
      </span>
    )
  }
  return (
    <span data-slot="morph-text" className={cn("inline-flex", className)} {...props}>
      <TextMorph as="span" duration={duration}>
        {String(children)}
      </TextMorph>
    </span>
  )
}

export { MorphText }
export type { MorphTextProps }
