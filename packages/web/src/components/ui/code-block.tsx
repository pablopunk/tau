import type * as React from "react"
import { CopyButton } from "@/components/ui/copy-button"
import { cn } from "@/lib/utils"

interface CodeBlockProps extends Omit<React.ComponentProps<"pre">, "children"> {
  text: string
  /** Show a copy button (for commands). Logs leave it off. */
  copyable?: boolean
}

/** Monospace text that wraps and scrolls, with an optional copy button. For commands and log tails. */
function CodeBlock({ text, copyable = false, className, ...props }: CodeBlockProps) {
  return (
    <div data-slot="code-block" className="relative min-w-0">
      <pre
        className={cn(
          "max-h-60 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-words whitespace-pre-wrap",
          copyable && "pr-10",
          className,
        )}
        {...props}
      >
        {text}
      </pre>
      {copyable && <CopyButton text={text} label="Copy command" className="absolute top-2 right-2" />}
    </div>
  )
}

export { CodeBlock }
