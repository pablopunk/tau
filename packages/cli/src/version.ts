import { readFileSync } from "node:fs";
import { definedVersion } from "./runtime/install-paths";

/** The `TAU_VERSION` define in a compiled binary; the `package.json` next to `src/` and `dist/` otherwise. */
export function cliVersion(): string {
  const defined = definedVersion();
  if (defined !== undefined) return defined;
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  return manifest.version;
}
