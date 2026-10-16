export const ICON_SIZE = 128;
export const MAX_ICON_BYTES = 256 * 1024;
export const ICON_BODY_LIMIT = 1024 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR_OFFSET = 12;
const WIDTH_OFFSET = 16;
const HEIGHT_OFFSET = 20;

const hasPngMagic = (bytes: Uint8Array) => PNG_MAGIC.every((value, index) => bytes[index] === value);
const hasIhdr = (bytes: Uint8Array) => String.fromCharCode(...bytes.subarray(IHDR_OFFSET, IHDR_OFFSET + 4)) === "IHDR";
const readUint32 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);

/** True for a PNG of exactly 128x128 pixels and at most 256 KB; reads only the signature and the IHDR. */
export function isIconPng(bytes: Uint8Array): boolean {
  if (bytes.length > MAX_ICON_BYTES || bytes.length < HEIGHT_OFFSET + 4) return false;
  if (!hasPngMagic(bytes) || !hasIhdr(bytes)) return false;
  return readUint32(bytes, WIDTH_OFFSET) === ICON_SIZE && readUint32(bytes, HEIGHT_OFFSET) === ICON_SIZE;
}
