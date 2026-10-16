import { AppError, type ImageInput } from "@pi-everywhere/protocol";

const MAGIC_BYTES: Record<ImageInput["mimeType"], readonly number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/webp": [0x52, 0x49, 0x46, 0x46],
  "image/gif": [0x47, 0x49, 0x46, 0x38],
};

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((value, index) => bytes[index] === value);
}

export function assertImageMatchesMimeType(image: ImageInput): void {
  const bytes = Uint8Array.from(atob(image.data.slice(0, 16)), (char) => char.charCodeAt(0));
  if (!startsWith(bytes, MAGIC_BYTES[image.mimeType])) {
    throw new AppError("invalid_request", `The image bytes are not ${image.mimeType}.`);
  }
}
