import { readFileSync } from "node:fs";

/** From the `package.json` next to `src/` and next to `dist/`. */
export function cliVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  return manifest.version;
}
