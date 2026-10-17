import { isAbsolute, resolve } from "node:path";
import { runGit } from "./run-git";

export type Repo = { readonly root: string; readonly commonDir: string };

/** Undefined when the folder is not inside a git work tree. */
export async function repoOf(cwd: string): Promise<Repo | undefined> {
  try {
    const out = await runGit({ cwd }, ["rev-parse", "--show-toplevel", "--git-common-dir"]);
    const [root, common] = out.trim().split("\n");
    if (!root || !common) return undefined;
    return { root, commonDir: isAbsolute(common) ? common : resolve(cwd, common) };
  } catch {
    return undefined;
  }
}
