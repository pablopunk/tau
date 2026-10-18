import * as React from "react"
import { cn } from "@/lib/utils"

interface HighlightedTextProps extends React.ComponentProps<"span"> {
  text: string
  /** Character ranges of `text` to emphasise, sorted and not overlapping. */
  ranges: ReadonlyArray<readonly [number, number]>
}

/** Plain text with some ranges marked, for showing why a search result matched. */
function HighlightedText({ text, ranges, className, ...props }: HighlightedTextProps) {
  const parts: React.ReactNode[] = []
  let cursor = 0
  ranges.forEach(([start, end], index) => {
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(
      <mark key={index} className="rounded-xs bg-primary/15 text-foreground">
        {text.slice(start, end)}
      </mark>
    )
    cursor = end
  })
  parts.push(text.slice(cursor))
  return (
    <span data-slot="highlighted-text" className={cn(className)} {...props}>
      {parts}
    </span>
  )
}

export { HighlightedText }
