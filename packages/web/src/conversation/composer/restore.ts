import type { ImageInput, QueuedMessage } from "@tau/protocol";
import { MAX_IMAGES_PER_MESSAGE } from "@tau/protocol";
import { loadFileAttachments, newFileAttachment, saveFileAttachments } from "../files/attachments";
import { loadAttachments, newAttachment, saveAttachments } from "../images/attachments";
import type { UserItemSnapshot } from "../queue/queue-contract";
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

/**
 * Puts server snapshots back in the draft of `target`, ahead of what is already typed.
 * Snapshots carry FileRefs (resolved server-side through the requestId sidecar), so Cancel and
 * Send-now restore files the client draft alone would lose. Images ride inside snapshot text as
 * blocks; staged file refs are re-attached by ref.
 */
export function restoreSnapshotsToComposer(target: string, snapshots: readonly UserItemSnapshot[]): void {
  const items = snapshots.filter((snapshot) => snapshot.text.trim().length > 0 || snapshot.files.length > 0);
  if (items.length === 0) return;
  saveDraft(target, joinText(items.map((snapshot) => snapshot.text).join("\n\n"), loadDraft(target)));
  const files = [
    ...loadFileAttachments(target),
    ...items.flatMap((snapshot) => snapshot.files.map((ref) => newFileAttachment(ref))),
  ];
  saveFileAttachments(target, files);
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
