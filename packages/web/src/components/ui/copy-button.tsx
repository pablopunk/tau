import { CheckIcon, CopyIcon } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"

const COPIED_MS = 1500

interface CopyButtonProps
  extends Omit<React.ComponentProps<typeof Button>, "onClick" | "children"> {
  text: string | (() => string)
  label?: string
}

function CopyButton({ text, label = "Copy", variant = "ghost", size = "icon-xs", ...props }: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  React.useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text)
    } catch {
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_MS)
  }

  return (
    <Button
      data-slot="copy-button"
      type="button"
      variant={variant}
      size={size}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={copy}
      {...props}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

export { CopyButton }
export type { CopyButtonProps }
