import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compiled, versionDir } from "./runtime/install-paths";

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/** In a compiled binary the UI is `<versionDir>/web`: the folder this exact version runs from. Otherwise: bundled (`dist/web/dist` next to `dist/bin.js`, as tsdown copies the folder inside the target) or, when run from source, the sibling web package build. */
const DEV_CANDIDATES = [here("./web/dist"), here("../../web/dist")];

const defaultCandidates = (): string[] => (compiled() ? [join(versionDir(), "web")] : DEV_CANDIDATES);

export function findStaticDir(candidates: readonly string[] = defaultCandidates()): string | undefined {
  return candidates.find((directory) => existsSync(join(directory, "index.html")));
}
