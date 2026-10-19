import type { ImageInput, QueuedMessage } from "@tau/protocol";
import { MAX_IMAGES_PER_MESSAGE } from "@tau/protocol";
import { loadAttachments, newAttachment, saveAttachments } from "../images/attachments";
import { loadDraft, saveDraft } from "./drafts";

const EVENT = "tau:composer-restore";

export interface RestoredMessage {
  text: string;
  images: readonly ImageInput[];
}

function joinText(restored: string, draft: string): string {
  return [restored, draft].filter((part) => part.trim().length > 0).join("\n\n");
}

function toImageInput({ mimeType, data }: QueuedMessage["images"][number]): ImageInput {
  return { mimeType: mimeType as ImageInput["mimeType"], data };
}

/** Puts a cancelled queued message back in the draft of `target`, ahead of what is already typed. */
export function restoreToComposer(target: string, message: RestoredMessage): void {
  saveDraft(target, joinText(message.text, loadDraft(target)));
  const images = [...loadAttachments(target), ...message.images.map((image) => newAttachment(image))];
  saveAttachments(target, images.slice(0, MAX_IMAGES_PER_MESSAGE));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: target }));
}

/** Puts withdrawn queued messages back in the draft of `target`, ahead of what is already typed. */
export function restoreQueuedToComposer(target: string, items: readonly QueuedMessage[]): void {
  if (items.length === 0) return;
  restoreToComposer(target, {
    text: items
      .map((item) => item.text)
      .filter((part) => part.trim().length > 0)
      .join("\n\n"),
    images: items.flatMap((item) => item.images.map(toImageInput)),
  });
}

export function onComposerRestore(target: string, listener: () => void): () => void {
  const handler = (event: Event) => {
    if ((event as CustomEvent<string>).detail === target) listener();
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
