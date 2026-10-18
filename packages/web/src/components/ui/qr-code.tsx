import QRCode from "qrcode"
import * as React from "react"
import { cn } from "@/lib/utils"

interface QrCodeProps extends Omit<React.ComponentProps<"svg">, "children"> {
  /** What a phone camera reads, for example the pairing link. */
  value: string
  /** Accessible name; the link itself is shown next to the code. */
  label?: string
}

const QUIET_ZONE = 2

function modulePath(value: string): { size: number; path: string } {
  const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" })
  const parts: string[] = []
  for (let row = 0; row < modules.size; row++) {
    for (let column = 0; column < modules.size; column++) {
      if (modules.get(column, row)) parts.push(`M${column + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`)
    }
  }
  return { size: modules.size + QUIET_ZONE * 2, path: parts.join("") }
}

/** A QR code as an inline SVG in the current text colour on the background colour. Placeholder styling: owner D finishes it. */
function QrCode({ value, label = "QR code", className, ...props }: QrCodeProps) {
  const { size, path } = React.useMemo(() => modulePath(value), [value])
  return (
    <svg
      data-slot="qr-code"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn("size-48 rounded-lg bg-background text-foreground", className)}
      {...props}
    >
      <path d={path} fill="currentColor" />
    </svg>
  )
}

export { QrCode }
