/** The signature and an IHDR chunk: all `isIconPng` reads. */
export function pngOfSize(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

export const iconPng = (shade = 0) => {
  const bytes = pngOfSize(128, 128);
  bytes[32] = shade;
  return bytes;
};
