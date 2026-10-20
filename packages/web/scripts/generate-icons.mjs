#!/usr/bin/env node
// Source of truth for every app icon: `public/favicon.svg`.
//
// Generates all raster icons plus `public/manifest.webmanifest` from that
// single SVG, so nothing can drift. Runs on every build; `pnpm check-icons`
// (used by tests) re-renders in memory and fails when a file is stale.
//
// Covers: SVG favicon (modern browsers), PNG favicon (Safari tabs, which has
// no SVG favicon support), apple-touch-icon (iOS home screen, 180x180
// opaque), manifest icons incl. maskable (Android adaptive icons, artwork
// kept inside the 80% safe zone on a solid tile).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const TILE = "#151C27";

const render = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();

const inner = (svg) => svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"));

// Maskable icons must survive aggressive cropping: shrink the artwork to the
// center 80% on a solid tile so masks only ever cut background.
const maskable = (svg, size) => {
  const margin = size * 0.1;
  const scale = (size * 0.8) / 32;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${TILE}"/>` +
    `<g transform="translate(${margin} ${margin}) scale(${scale})">${inner(svg)}</g></svg>`
  );
};

const files = (svg) => ({
  "favicon-32x32.png": render(svg, 32),
  "apple-touch-icon.png": render(svg, 180),
  "icon-192.png": render(svg, 192),
  "icon-512.png": render(svg, 512),
  "icon-maskable-192.png": render(maskable(svg, 192), 192),
  "icon-maskable-512.png": render(maskable(svg, 512), 512),
  "manifest.webmanifest": Buffer.from(
    `${JSON.stringify(
      {
        name: "tau",
        short_name: "tau",
        start_url: ".",
        display: "standalone",
        background_color: TILE,
        theme_color: TILE,
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-maskable-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      null,
      2,
    )}\n`,
  ),
});

const svg = readFileSync(join(root, "favicon.svg"), "utf8");
const outputs = files(svg);

if (process.argv.includes("--check")) {
  const stale = Object.entries(outputs).filter(
    ([name, bytes]) => !readFileSync(join(root, name)).equals(bytes),
  );
  if (stale.length > 0) {
    console.error(
      `Icons out of sync with favicon.svg: ${stale.map(([name]) => name).join(", ")}\nRun: pnpm --filter @tau/web generate-icons`,
    );
    process.exit(1);
  }
  console.log("app icons in sync with favicon.svg");
} else {
  for (const [name, bytes] of Object.entries(outputs)) writeFileSync(join(root, name), bytes);
  console.log(`generated ${Object.keys(outputs).length} icon files from favicon.svg`);
}
