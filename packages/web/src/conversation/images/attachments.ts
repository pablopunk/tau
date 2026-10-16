import type { ImageInput } from "@pi-everywhere/protocol";
import { MAX_IMAGES_PER_MESSAGE } from "@pi-everywhere/protocol";

export interface Attachment {
  id: number;
  image: ImageInput;
}

const byTarget = new Map<string, Attachment[]>();
let nextId = 1;

export function loadAttachments(target: string): Attachment[] {
  return byTarget.get(target) ?? [];
}

export function saveAttachments(target: string, attachments: Attachment[]): void {
  if (attachments.length === 0) byTarget.delete(target);
  else byTarget.set(target, attachments);
}

export function newAttachment(image: ImageInput): Attachment {
  return { id: nextId++, image };
}

export function roomLeft(attachments: readonly Attachment[]): number {
  return MAX_IMAGES_PER_MESSAGE - attachments.length;
}

export function imageSrc(image: ImageInput): string {
  return `data:${image.mimeType};base64,${image.data}`;
}
