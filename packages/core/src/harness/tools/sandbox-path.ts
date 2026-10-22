import { constants } from "node:fs";
import { type FileHandle, open, realpath, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

/**
 * Layer-2 confinement for in-process writes (`edit`, `write`). Spawned processes
 * are covered by Layer 1 (OS sandbox); these tools never spawn, so the check
 * lives here, in our code, which the agent cannot bypass.
 *
 * Fail-closed throughout: any unresolvable path, symlink trick or post-open
 * mismatch denies the write with `SandboxDenied`.
 */
export class SandboxDenied extends Error {
  readonly code = "sandbox_denied";
  constructor(path: string, root: string) {
    super(`Write denied: ${path} is outside the sandboxed worktree ${root}.`);
  }
}

const insideRoot = (root: string, resolved: string): boolean =>
  resolved === root || resolved.startsWith(root + sep);

/** The canonical root every write is checked against. Throws `SandboxDenied` when unusable. */
export async function canonicalSandboxRoot(root: string): Promise<string> {
  let canonical: string;
  try {
    canonical = await realpath(resolve(root));
  } catch {
    throw new SandboxDenied(root, root);
  }
  const info = await stat(canonical).catch(() => undefined);
  if (!info?.isDirectory()) throw new SandboxDenied(root, root);
  return canonical;
}

/**
 * Resolve `target` (absolute or relative to `cwd`) against a canonical root.
 * The parent directory is resolved through symlinks, so a symlinked parent
 * pointing outside denies; the final component is NOT resolved here — the
 * open below uses `O_NOFOLLOW`, so a symlinked final component fails closed.
 */
export async function resolveWriteTarget(
  target: string,
  root: string,
  cwd: string = process.cwd(),
): Promise<{ canonicalRoot: string; resolved: string }> {
  const canonicalRoot = await canonicalSandboxRoot(root);
  const resolved = resolve(cwd, target);
  if (insideRoot(canonicalRoot, resolved)) return { canonicalRoot, resolved };
  // A symlinked parent may still land inside; only the real parent decides.
  let realParent: string;
  try {
    realParent = await realpath(dirname(resolved));
  } catch {
    throw new SandboxDenied(target, canonicalRoot);
  }
  if (!insideRoot(canonicalRoot, realParent)) throw new SandboxDenied(target, canonicalRoot);
  return { canonicalRoot, resolved };
}

const sameFile = (a: { dev: number; ino: number }, b: { dev: number; ino: number }): boolean =>
  a.dev === b.dev && a.ino === b.ino;

/**
 * Open a file for writing inside `root` with `O_NOFOLLOW`, then revalidate:
 * the opened fd must be the same file the path resolves to, and its real
 * parent must still sit inside the root. Anything else closes the fd and
 * denies. Callers write through the returned handle.
 */
export async function openConfinedWrite(target: string, root: string, cwd: string = process.cwd()) {
  const { canonicalRoot, resolved } = await resolveWriteTarget(target, root, cwd);
  let handle: FileHandle;
  try {
    handle = await open(resolved, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o666);
  } catch {
    throw new SandboxDenied(target, canonicalRoot);
  }
  try {
    const [opened, current, realParent] = await Promise.all([
      handle.stat(),
      stat(resolved),
      realpath(dirname(resolved)).catch(() => undefined),
    ]);
    if (realParent === undefined || !insideRoot(canonicalRoot, realParent) || !sameFile(opened, current)) {
      throw new SandboxDenied(target, canonicalRoot);
    }
    return { handle, resolved, root: canonicalRoot };
  } catch (error) {
    await handle.close().catch(() => undefined);
    if (error instanceof SandboxDenied) throw error;
    throw new SandboxDenied(target, canonicalRoot);
  }
}

/** Deny when the write would land outside `root`; return the resolved path when allowed. */
export async function assertWriteAllowed(
  target: string,
  root: string,
  cwd: string = process.cwd(),
): Promise<string> {
  const { handle, resolved } = await openConfinedWrite(target, root, cwd);
  await handle.close().catch(() => undefined);
  return resolved;
}
