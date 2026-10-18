import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"

interface ImagePreviewProps {
  src: string
  alt: string
}

function ImagePreview({ src, alt }: ImagePreviewProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label={`Open ${alt}`}
        onClick={() => setOpen(true)}
        className="block cursor-zoom-in rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-60 max-w-full rounded-lg border bg-muted object-contain"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogTitle>{alt}</DialogTitle>
          <DialogDescription className="sr-only">Full size image</DialogDescription>
          <img src={src} alt={`${alt}, full size`} className="max-h-[75vh] w-full object-contain" />
        </DialogContent>
      </Dialog>
    </>
  )
}

export { ImagePreview }
