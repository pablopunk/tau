import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Trusted thread metadata for one spawn. The integrator builds this from thread
 * metadata (project + workspace + worktree name), never from the tool's `cwd`.
 */
export interface TrustInput {
  readonly kind: "worktree" | "checkout" | "main" | "non-git" | "removed";
  /** Canonical worktree root (`worktree`/`non-git`) or main checkout root (`checkout`/`main`). */
  readonly root?: string;
  /** Thread's git admin dir + branch, when known: narrows the shared-`.git` allowlist. */
  readonly adminDir?: string;
  readonly sharedGitDir?: string;
  readonly branch?: string;
}

export type RootResolution =
  | { readonly ok: true; readonly root: string }
  | { readonly ok: false; readonly reason: string };

export interface FsSeam {
  readonly realpath: (path: string) => string;
  readonly isDirectory: (path: string) => boolean;
}

const realFs: FsSeam = {
  realpath: (path) => realpathSync(path),
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
};

const deny = (reason: string): RootResolution => ({ ok: false, reason });

/**
 * Fail-closed root resolution. Never substitutes `cwd`: there is no `cwd`
 * parameter by construction. Unresolvable (missing, removed, not a directory)
 * denies; the caller rejects the spawn.
 */
export function resolveSandboxRoot(input: TrustInput | undefined, fs: FsSeam = realFs): RootResolution {
  if (!input) return deny("No trusted thread metadata: cannot resolve a sandbox root.");
  if (input.kind === "removed") return deny("The worktree was removed: spawns are denied.");
  const raw = input.root?.trim();
  if (!raw) return deny("No trusted root for this thread: spawns are denied.");
  let root: string;
  try {
    root = fs.realpath(resolve(raw));
  } catch {
    return deny(`Trusted root ${raw} does not resolve: spawns are denied.`);
  }
  if (!fs.isDirectory(root)) return deny(`Trusted root ${root} is not a directory: spawns are denied.`);
  return { ok: true, root };
}

/** True when the resolved path sits inside the sandbox root (the root itself counts). */
export function isInsideRoot(root: string, path: string, fs: FsSeam = realFs): boolean {
  let resolved: string;
  try {
    resolved = fs.realpath(resolve(path));
  } catch {
    return false;
  }
  return resolved === root || resolved.startsWith(`${root}/`);
}
