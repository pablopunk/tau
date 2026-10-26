import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const pngSize = (file: string) => {
  const bytes = readFileSync(file);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

describe("app icons", () => {
  it("derives every icon from favicon.svg", () => {
    execFileSync("node", ["scripts/generate-icons.mjs", "--check"], { cwd: root });
  });

  it("links every icon from index.html", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    for (const tag of [
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
      '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />',
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
      '<link rel="manifest" href="/manifest.webmanifest" />',
      '<meta name="theme-color"',
      '<meta name="mobile-web-app-capable" content="yes" />',
      '<meta name="apple-mobile-web-app-capable" content="yes" />',
    ])
      expect(html).toContain(tag);
  });

  it("ships a manifest whose icons exist at the declared sizes", () => {
    const manifest = JSON.parse(readFileSync(join(root, "public", "manifest.webmanifest"), "utf8"));
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      const [width, height] = icon.sizes.split("x").map(Number);
      const file = join(root, "public", icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      expect(pngSize(file)).toEqual({ width, height });
    }
  });
});
