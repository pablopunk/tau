import { tryGit } from "./run-repo-command";

export interface GitRepoProbe {
  isGitRepo(path: string): Promise<boolean>;
}

/** Only a positive answer is cached: a folder can become a repository later. */
export function createGitRepoProbe(): GitRepoProbe {
  const known = new Set<string>();
  return {
    async isGitRepo(path) {
      if (known.has(path)) return true;
      const found = (await tryGit(path, ["rev-parse", "--show-toplevel"])).ok;
      if (found) known.add(path);
      return found;
    },
  };
}
