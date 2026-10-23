import {
  type FileRef,
  type ImageInput,
  MAX_IMAGE_BASE64_LENGTH,
  MAX_IMAGES_PER_MESSAGE,
  MAX_UPLOAD_FILE_BYTES,
} from "@tau/protocol";

export interface FirstMessage {
  readonly text: string;
  readonly images: readonly ImageInput[];
  readonly files?: readonly FileRef[];
}

export const FIRST_MESSAGE_STATE_KEY = "tauFirstMessage";

export function firstMessageState(message: FirstMessage): Record<string, unknown> {
  return { [FIRST_MESSAGE_STATE_KEY]: message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isImageInput(value: unknown): value is ImageInput {
  return (
    isRecord(value) &&
    (value.mimeType === "image/png" ||
      value.mimeType === "image/jpeg" ||
      value.mimeType === "image/webp" ||
      value.mimeType === "image/gif") &&
    typeof value.data === "string" &&
    value.data.length <= MAX_IMAGE_BASE64_LENGTH
  );
}

function isFileRef(value: unknown): value is FileRef {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    value.name.length >= 1 &&
    value.name.length <= 255 &&
    typeof value.path === "string" &&
    value.path.length >= 1 &&
    value.path.length <= 1024 &&
    Number.isInteger(value.size) &&
    typeof value.size === "number" &&
    value.size >= 0 &&
    value.size <= MAX_UPLOAD_FILE_BYTES
  );
}

export function firstMessageOf(locationState: unknown): FirstMessage | undefined {
  try {
    if (!isRecord(locationState)) return undefined;
    const value = locationState[FIRST_MESSAGE_STATE_KEY];
    if (!isRecord(value) || typeof value.text !== "string" || !Array.isArray(value.images)) return undefined;
    if (value.images.length > MAX_IMAGES_PER_MESSAGE || !value.images.every(isImageInput)) return undefined;
    const files = value.files ?? [];
    if (!Array.isArray(files) || !files.every(isFileRef)) return undefined;
    return { text: value.text, images: value.images, files };
  } catch {
    return undefined;
  }
}
