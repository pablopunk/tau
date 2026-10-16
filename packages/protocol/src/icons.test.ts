import { describe, expect, it } from "vitest";
import { iconCandidateUrl, isIconPng, projectIconUrl, routes } from "./index";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("isIconPng", () => {
  it("accepts a 128x128 png", () => expect(isIconPng(png(128, 128))).toBe(true));
  it("rejects other sizes, other formats and big files", () => {
    expect(isIconPng(png(64, 128))).toBe(false);
    expect(isIconPng(new Uint8Array(40))).toBe(false);
    expect(isIconPng(new Uint8Array(300 * 1024))).toBe(false);
  });
});

describe("icon urls", () => {
  it("builds the project icon url with a version", () => {
    expect(projectIconUrl("a b", "auto")).toBe("/api/projects/a%20b/icon?v=auto");
  });
  it("builds a candidate url with an encoded name", () => {
    expect(iconCandidateUrl("p1", "public/a b.png")).toBe(
      "/api/projects/p1/icon-candidates/file?name=public%2Fa%20b.png",
    );
  });
  it("marks image routes", () => {
    expect(routes.getProjectIcon.responseKind).toBe("image");
  });
});
