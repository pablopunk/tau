import type { ImageContent } from "@pi-everywhere/protocol";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ImageThumbnail } from "@/components/ui/image-thumbnail";

function srcOf(image: ImageContent): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

export function MessageImages({ images }: { images: readonly ImageContent[] }) {
  const [open, setOpen] = useState<number>();
  if (images.length === 0) return null;
  const opened = open === undefined ? undefined : images[open];
  return (
    <>
      <ul aria-label="Images" className="flex flex-wrap justify-end gap-2">
        {images.map((image, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: images have no id and the list never reorders
          <li key={index}>
            <ImageThumbnail
              src={srcOf(image)}
              alt={`Attachment ${index + 1}`}
              onOpen={() => setOpen(index)}
            />
          </li>
        ))}
      </ul>
      <Dialog open={opened !== undefined} onOpenChange={(next) => !next && setOpen(undefined)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogTitle>Attachment {(open ?? 0) + 1}</DialogTitle>
          <DialogDescription className="sr-only">Full size image</DialogDescription>
          {opened ? (
            <img
              src={srcOf(opened)}
              alt={`Attachment ${(open ?? 0) + 1}, full size`}
              className="max-h-[75vh] w-full object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
