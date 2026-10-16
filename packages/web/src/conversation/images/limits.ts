import { MAX_IMAGE_BASE64_LENGTH } from "@pi-everywhere/protocol";

export const MAX_SIDE = 2048;
export const REENCODE_ABOVE_BYTES = 1.5 * 1024 * 1024;
export { MAX_IMAGE_BASE64_LENGTH };

export const SUPPORTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type SupportedType = (typeof SUPPORTED_TYPES)[number];

export function isSupportedType(type: string): type is SupportedType {
  return (SUPPORTED_TYPES as readonly string[]).includes(type);
}

export function fitWithin(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function needsReencode(width: number, height: number, bytes: number): boolean {
  return Math.max(width, height) > MAX_SIDE || bytes > REENCODE_ABOVE_BYTES;
}
