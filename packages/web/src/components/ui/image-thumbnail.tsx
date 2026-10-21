import { XIcon } from "lucide-react"
import type * as React from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ImageThumbnailProps extends Omit<React.ComponentProps<"div">, "children" | "onClick"> {
  src: string
  alt: string
  /** Shows a remove button over the preview. */
  onRemove?: () => void
  /** Makes the preview itself a button, e.g. to open it larger. */
  onOpen?: () => void
}

function ImageThumbnail({ src, alt, onRemove, onOpen, className, ...props }: ImageThumbnailProps) {
  const image = (
    <img src={src} alt={alt} className="size-full object-cover" draggable={false} />
  )
  return (
    <div
      data-slot="image-thumbnail"
      className={cn("relative size-16 shrink-0 overflow-hidden rounded-lg border bg-muted", className)}
      {...props}
    >
      {onOpen ? (
        <button
          type="button"
          aria-label={`Open ${alt}`}
          onClick={onOpen}
          className="size-full cursor-zoom-in outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {image}
        </button>
      ) : (
        image
      )}
      {onRemove ? (
        // A 44px coarse target would swallow the 64px preview: keep the small
        // visual and grow only the hit area.
        <Button
          type="button"
          variant="secondary"
          size="icon-xs"
          aria-label={`Remove ${alt}`}
          onClick={onRemove}
          className="absolute top-0.5 right-0.5 size-5 rounded-full after:absolute after:-bottom-4 after:-left-4 after:top-0 after:right-0 pointer-coarse:size-5 pointer-coarse:[&_svg:not([class*='size-'])]:size-3"
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  )
}

export { ImageThumbnail }
export type { ImageThumbnailProps }
