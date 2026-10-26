import type { ConversationView, ImageRef } from "@tau/protocol";
import { imageRefsOf } from "@tau/protocol";

export interface SidebarImage extends ImageRef {
  readonly alt: string;
}

function altOf(ref: ImageRef, index: number): string {
  return `${ref.source === "agent" ? "Gallery agent image" : "Gallery image"} ${index + 1}`;
}

export function collectConversationImages(view: ConversationView): readonly SidebarImage[] {
  return imageRefsOf(view).map((ref, index) => ({ ...ref, alt: altOf(ref, index) }));
}
