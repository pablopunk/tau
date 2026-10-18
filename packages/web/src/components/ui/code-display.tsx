import type * as React from "react"
import { cn } from "@/lib/utils"

const GROUP = 4

/** `ABCD2345` becomes `ABCD 2345`. */
function groupCode(code: string): string {
  const groups: string[] = []
  for (let at = 0; at < code.length; at += GROUP) groups.push(code.slice(at, at + GROUP))
  return groups.join(" ")
}

/** A short code in large monospace type, in groups of four, easy to read out and type. */
function CodeDisplay({ code, className, ...props }: Omit<React.ComponentProps<"p">, "children"> & { code: string }) {
  return (
    <p
      data-slot="code-display"
      aria-label={`Code ${code.split("").join(" ")}`}
      className={cn("font-mono text-3xl font-semibold tracking-widest select-all", className)}
      {...props}
    >
      <span aria-hidden>{groupCode(code)}</span>
    </p>
  )
}

export { CodeDisplay, groupCode }
