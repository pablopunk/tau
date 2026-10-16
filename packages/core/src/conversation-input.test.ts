import { describe, expect, it } from "vitest";
import {
  requireContent,
  requireImageBytesMatchTheirType,
  requireImagesAllowed,
  toUserInput,
} from "./conversation-input";
import { titleFromFirstMessage, titleFromModelAnswer } from "./conversation-title";

const PNG = {
  mimeType: "image/png" as const,
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
};
const JPEG_AS_PNG = { mimeType: "image/png" as const, data: "/9j/4AAQSkZJRgABAQEASABIAAD" };

describe("message input", () => {
  it("maps text only to a string and images to parts, skipping blank text", () => {
    expect(toUserInput({ text: "hi" })).toBe("hi");
    expect(toUserInput({ text: "hi", images: [PNG] })).toEqual([
      { type: "text", text: "hi" },
      { type: "image", ...PNG },
    ]);
    expect(toUserInput({ text: "  ", images: [PNG] })).toEqual([{ type: "image", ...PNG }]);
  });

  it("requires text or an image", () => {
    expect(() => requireContent({ text: " " })).toThrow(expect.objectContaining({ code: "invalid_request" }));
    expect(() => requireContent({ text: "", images: [PNG] })).not.toThrow();
  });

  it("checks magic bytes against the declared type", () => {
    expect(() => requireImageBytesMatchTheirType({ images: [PNG] })).not.toThrow();
    expect(() => requireImageBytesMatchTheirType({ images: [JPEG_AS_PNG] })).toThrow(
      expect.objectContaining({ code: "invalid_request" }),
    );
  });

  it("rejects images for a text-only or unknown model", () => {
    expect(() => requireImagesAllowed({ images: [PNG] }, { input: ["text"] })).toThrow(
      expect.objectContaining({ code: "images_not_supported" }),
    );
    expect(() => requireImagesAllowed({ images: [PNG] }, undefined)).toThrow(
      expect.objectContaining({ code: "images_not_supported" }),
    );
    expect(() => requireImagesAllowed({ images: [PNG] }, { input: ["text", "image"] })).not.toThrow();
    expect(() => requireImagesAllowed({}, { input: ["text"] })).not.toThrow();
  });
});

describe("titles", () => {
  it("builds a provisional title and names image-only messages", () => {
    expect(titleFromFirstMessage("  a\n\nb  c ")).toBe("a b c");
    expect(titleFromFirstMessage("")).toBe("Image");
    expect(titleFromFirstMessage("x ".repeat(100)).length).toBeLessThanOrEqual(80);
  });

  it("cleans a model answer", () => {
    expect(titleFromModelAnswer('Title: "Fix it"\nmore')).toBe("Fix it");
    expect(titleFromModelAnswer("  ")).toBeUndefined();
    expect(titleFromModelAnswer("y".repeat(200))?.length).toBe(80);
  });
});
