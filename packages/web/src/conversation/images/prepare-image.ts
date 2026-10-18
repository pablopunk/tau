import type { ImageInput } from "@tau/protocol";
import { isSupportedType, MAX_IMAGE_BASE64_LENGTH, needsReencode } from "./limits";
import { readDimensions, resizeAndEncode } from "./resize-image";

export class ImageRejected extends Error {}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });
}

async function encodeAsIs(file: File, mimeType: ImageInput["mimeType"]): Promise<ImageInput> {
  return { mimeType, data: await blobToBase64(file) };
}

async function encodeCompressed(file: File): Promise<ImageInput> {
  const blob = await resizeAndEncode(file);
  return { mimeType: blob.type as ImageInput["mimeType"], data: await blobToBase64(blob) };
}

async function compress(file: File, mimeType: ImageInput["mimeType"]): Promise<ImageInput> {
  if (mimeType === "image/gif") return encodeAsIs(file, mimeType);
  const { width, height } = await readDimensions(file);
  return needsReencode(width, height, file.size) ? encodeCompressed(file) : encodeAsIs(file, mimeType);
}

function nameOf(file: File, fallback: string): string {
  return file.name || fallback;
}

export async function prepareImage(file: File): Promise<ImageInput> {
  if (!isSupportedType(file.type)) {
    throw new ImageRejected(`${nameOf(file, "File")} is not a PNG, JPEG, WebP or GIF image.`);
  }
  const image = await compress(file, file.type).catch(() => {
    throw new ImageRejected(`${nameOf(file, "Image")} could not be read.`);
  });
  if (image.data.length > MAX_IMAGE_BASE64_LENGTH) {
    throw new ImageRejected(`${nameOf(file, "Image")} is too large, even after compression.`);
  }
  return image;
}
