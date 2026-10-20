import { realpathSync } from "node:fs";
import { compiled, installRootOf } from "../runtime/install-paths";

/** `<root>` of `<root>/versions/<v>/tau` for the running binary; undefined in a dev checkout or a hand-placed binary. */
export function installRootOfThisTau(): string | undefined {
  return compiled() ? installRootOf(realpathSync(process.execPath)) : undefined;
}
