import type { ConversationView, ImageContent } from "@tau/protocol";

export interface SidebarImage {
  readonly src: string;
  readonly alt: string;
  readonly entryId: string;
  /** User-attached vs read back by the agent (tool results, e.g. Read with images). */
  readonly source: "user" | "agent";
}

function srcOf(image: ImageContent): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

function imagesIn(content: unknown): readonly ImageContent[] {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (block): block is ImageContent =>
      typeof block === "object" && block !== null && (block as { type?: unknown }).type === "image",
  );
}

/** Every image in the conversation: user-sent plus images the agent read back from tools. */
export function collectConversationImages(view: ConversationView): readonly SidebarImage[] {
  const out: SidebarImage[] = [];
  for (const entry of view.entries) {
    const message = entry.model?.[0] as { role?: string; content?: unknown } | undefined;
    if (!message || typeof message.content === "string") continue;
    const images = imagesIn(message.content);
    if (images.length === 0) continue;
    if (entry.kind === "pi.tool-result") {
      for (const image of images)
        out.push({
          src: srcOf(image),
          alt: `Gallery agent image ${out.length + 1}`,
          entryId: String(entry.id),
          source: "agent",
        });
    } else {
      for (const image of images) {
        out.push({
          src: srcOf(image),
          alt: `Gallery image ${out.length + 1}`,
          entryId: String(entry.id),
          source: "user",
        });
      }
    }
  }
  return out;
}
