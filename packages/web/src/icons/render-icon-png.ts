export const ICON_SIZE = 128;

const loadImage = (blob: Blob) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This file is not an image the browser can read."));
    };
    image.src = url;
  });

export const letterbox = (width: number, height: number) => {
  const scale = Math.min(ICON_SIZE / width, ICON_SIZE / height);
  const w = width * scale;
  const h = height * scale;
  return { x: (ICON_SIZE - w) / 2, y: (ICON_SIZE - h) / 2, w, h };
};

const toPngBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the icon."))),
      "image/png",
    ),
  );

/** Redraws any image onto a transparent 128x128 canvas, centered with its aspect ratio kept. */
export async function renderIconPng(source: Blob): Promise<Uint8Array> {
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const { x, y, w, h } = letterbox(image.naturalWidth || ICON_SIZE, image.naturalHeight || ICON_SIZE);
  canvas.getContext("2d")?.drawImage(image, x, y, w, h);
  return new Uint8Array(await (await toPngBlob(canvas)).arrayBuffer());
}
