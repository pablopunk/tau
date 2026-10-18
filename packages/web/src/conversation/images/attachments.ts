import type { ImageInput } from "@tau/protocol";
import { MAX_IMAGES_PER_MESSAGE } from "@tau/protocol";

export interface Attachment {
  id: number;
  image: ImageInput;
}

const PREFIX = "tau:attachments:";
const byTarget = new Map<string, Attachment[]>();
let nextId = 1;

const keyOf = (target: string): string => PREFIX + target;

function isImageInput(value: unknown): value is ImageInput {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ImageInput).mimeType === "string" &&
    (value as ImageInput).mimeType.startsWith("image/") &&
    typeof (value as ImageInput).data === "string" &&
    (value as ImageInput).data.length > 0
  );
}

function readStored(target: string): Attachment[] | null {
  try {
    const raw = window.localStorage.getItem(keyOf(target));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isImageInput)) {
      window.localStorage.removeItem(keyOf(target));
      return null;
    }
    return parsed.map((image) => newAttachment(image));
  } catch {
    return null;
  }
}

function writeStored(target: string, attachments: Attachment[]): void {
  try {
    if (attachments.length === 0) window.localStorage.removeItem(keyOf(target));
    else window.localStorage.setItem(keyOf(target), JSON.stringify(attachments.map((item) => item.image)));
  } catch {
    // Storage unavailable or quota exceeded (images are base64-heavy):
    // keep the in-memory copy so the current session still works.
  }
}

export function loadAttachments(target: string): Attachment[] {
  const cached = byTarget.get(target);
  if (cached) return cached;
  const stored = readStored(target);
  if (stored) byTarget.set(target, stored);
  return byTarget.get(target) ?? [];
}

export function saveAttachments(target: string, attachments: Attachment[]): void {
  if (attachments.length === 0) byTarget.delete(target);
  else byTarget.set(target, attachments);
  writeStored(target, attachments);
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
