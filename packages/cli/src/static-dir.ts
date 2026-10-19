import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/** Bundled (`dist/web/dist` next to `dist/bin.js`, as tsdown copies the folder inside the target) or, when run from source, the sibling web package build. */
const CANDIDATES = [here("./web/dist"), here("../../web/dist")];

export function findStaticDir(candidates: readonly string[] = CANDIDATES): string | undefined {
  return candidates.find((directory) => existsSync(join(directory, "index.html")));
}
