import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BASE64_LENGTH } from "./limits";
import { prepareImage } from "./prepare-image";
import { readDimensions, resizeAndEncode } from "./resize-image";

vi.mock("./resize-image", () => ({ readDimensions: vi.fn(), resizeAndEncode: vi.fn() }));

const dimensions = vi.mocked(readDimensions);
const encode = vi.mocked(resizeAndEncode);

function fileOf(bytes: number, type: string, name = "pic"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

beforeEach(() => {
  dimensions.mockReset().mockResolvedValue({ width: 800, height: 600 });
  encode.mockReset().mockResolvedValue(new Blob([new Uint8Array(10)], { type: "image/webp" }));
});

describe("prepareImage", () => {
  it("keeps a small image within 2048 px as is", async () => {
    const image = await prepareImage(fileOf(100, "image/png"));
    expect(image.mimeType).toBe("image/png");
    expect(encode).not.toHaveBeenCalled();
  });

  it("resizes and re-encodes an image with a side over 2048 px", async () => {
    dimensions.mockResolvedValue({ width: 4000, height: 3000 });
    const image = await prepareImage(fileOf(100, "image/png"));
    expect(encode).toHaveBeenCalledTimes(1);
    expect(image.mimeType).toBe("image/webp");
  });

  it("re-encodes an image over 1.5 MB even when small in pixels", async () => {
    await prepareImage(fileOf(1.6 * 1024 * 1024, "image/jpeg"));
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it("checks the limit after compression", async () => {
    dimensions.mockResolvedValue({ width: 4000, height: 4000 });
    const image = await prepareImage(fileOf(5 * 1024 * 1024, "image/png"));
    expect(image.data.length).toBeLessThan(MAX_IMAGE_BASE64_LENGTH);
  });

  it("keeps a GIF as is when it fits", async () => {
    const image = await prepareImage(fileOf(2 * 1024 * 1024, "image/gif"));
    expect(image.mimeType).toBe("image/gif");
    expect(encode).not.toHaveBeenCalled();
  });

  it("rejects a GIF over the limit", async () => {
    await expect(prepareImage(fileOf(4 * 1024 * 1024, "image/gif", "big.gif"))).rejects.toThrow(
      "big.gif is too large",
    );
  });

  it("rejects a type that is not supported", async () => {
    await expect(prepareImage(fileOf(10, "image/heic", "a.heic"))).rejects.toThrow("not a PNG");
  });
});
