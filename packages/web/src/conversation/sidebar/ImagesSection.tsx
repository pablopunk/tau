import type { ConversationView } from "@tau/protocol";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ImageThumbnail } from "@/components/ui/image-thumbnail";
import { collectConversationImages } from "./collect-images";
import { SidebarSection } from "./SidebarSection";

export function ImagesSection({ view }: { view: ConversationView }) {
  const [open, setOpen] = useState<number>();
  const images = collectConversationImages(view);
  if (images.length === 0) return null;
  const opened = open === undefined ? undefined : images[open];
  const agentCount = images.filter((image) => image.source === "agent").length;
  return (
    <SidebarSection title="Images" count={images.length}>
      <ul aria-label="Conversation images" className="flex flex-wrap gap-1.5">
        {images.map((image, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: images have no id and never reorder
          <li key={`${image.entryId}-${index}`}>
            <ImageThumbnail
              src={image.src}
              alt={image.alt}
              onOpen={() => setOpen(index)}
              title={image.source === "agent" ? "Read by the agent" : "Sent by you"}
            />
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {agentCount > 0
          ? `${images.length - agentCount} sent · ${agentCount} read by the agent`
          : "Sent in this conversation"}
      </p>
      <Dialog open={opened !== undefined} onOpenChange={(next) => !next && setOpen(undefined)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogTitle>
            {(open ?? 0) + 1} of {images.length}
          </DialogTitle>
          <DialogDescription className="sr-only">Full size image</DialogDescription>
          {opened ? (
            <img
              src={opened.src}
              alt={`${opened.alt}, full size`}
              className="max-h-[75vh] w-full object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </SidebarSection>
  );
}
