import { join } from "node:path";

/**
 * The writable set for git, from the measured sets in the plan (spike 77216):
 * `status`/`log` write nothing; `add` writes the file + admin `index` + one
 * shared blob; `commit` writes admin `index`/`logs/HEAD`/`COMMIT_EDITMSG` +
 * shared objects + ONLY its own branch ref+reflog; `fetch` writes admin
 * `FETCH_HEAD` + shared `refs/remotes/*` + their reflogs + objects.
 */
export interface GitScope {
  /** The thread's checkout. */
  readonly worktreeRoot: string;
  /** The thread's own admin dir (`<main>/.git/worktrees/<name>`). */
  readonly adminDir: string;
  /** The shared main-repo git dir. */
  readonly sharedGitDir: string;
  /** The thread's branch, bare name (`feature/x`). */
  readonly branch: string;
}

export const ownRefPaths = (sharedGitDir: string, branch: string) =>
  ({
    ref: join(sharedGitDir, "refs", "heads", branch),
    reflog: join(sharedGitDir, "logs", "refs", "heads", branch),
  }) as const;

/**
 * Writable = whole checkout + whole own admin dir + shared `objects/` + own
 * branch ref/reflog (+ lock siblings) + `refs/remotes/*` and `refs/tags/*`
 * with their reflogs (fetch). Everything else in shared `.git` stays denied.
 */
export function gitReadWritePaths(scope: GitScope): string[] {
  const { ref, reflog } = ownRefPaths(scope.sharedGitDir, scope.branch);
  return [
    scope.worktreeRoot,
    scope.adminDir,
    join(scope.sharedGitDir, "objects"),
    ref,
    `${ref}.lock`,
    reflog,
    `${reflog}.lock`,
    join(scope.sharedGitDir, "refs", "remotes"),
    join(scope.sharedGitDir, "logs", "refs", "remotes"),
    join(scope.sharedGitDir, "refs", "tags"),
    join(scope.sharedGitDir, "logs", "refs", "tags"),
  ];
}

const under = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);

/**
 * Classifies a write to shared git state for tests and review. The checkout
 * and the thread's own admin dir are always allowed; shared state is allowed
 * only inside the allowlist above (other branches' refs, `HEAD`, `config`,
 * `hooks/`, `info/`, top-level `index`/`logs/HEAD`, `packed-refs` deny).
 */
export function classifySharedGitWrite(path: string, scope: GitScope): "allow" | "deny" {
  if (under(path, scope.worktreeRoot) || under(path, scope.adminDir)) return "allow";
  if (!under(path, scope.sharedGitDir)) return "deny";
  return gitReadWritePaths(scope).some((allowed) => under(path, allowed)) ? "allow" : "deny";
}
