import * as React from "react"
import { cn } from "@/lib/utils"

interface DropZoneProps extends Omit<React.ComponentProps<"div">, "onDrop"> {
  onFiles: (files: File[]) => void
  disabled?: boolean
  label?: string
}

const hasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes("Files")

function DropZone({
  onFiles,
  disabled,
  label = "Drop to attach",
  className,
  children,
  ...props
}: DropZoneProps) {
  const [depth, setDepth] = React.useState(0)
  const active = depth > 0 && !disabled

  const track = (change: number) => (event: React.DragEvent) => {
    if (disabled || !hasFiles(event)) return
    event.preventDefault()
    setDepth((current) => Math.max(0, current + change))
  }

  const drop = (event: React.DragEvent) => {
    if (disabled || !hasFiles(event)) return
    event.preventDefault()
    setDepth(0)
    onFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div
      data-slot="drop-zone"
      data-active={active || undefined}
      className={cn("relative", className)}
      onDragEnter={track(1)}
      onDragLeave={track(-1)}
      onDragOver={(event) => hasFiles(event) && !disabled && event.preventDefault()}
      onDrop={drop}
      {...props}
    >
      {children}
      {active ? (
        <div
          data-slot="drop-zone-overlay"
          className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/60 bg-background/80 text-sm font-medium"
        >
          {label}
        </div>
      ) : null}
    </div>
  )
}

export { DropZone }
export type { DropZoneProps }
