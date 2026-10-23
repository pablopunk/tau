import { constants } from "node:fs";
import { type FileHandle, lstat, mkdir, open, realpath, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

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
 * The parent directory is always resolved through symlinks, before anything is
 * opened, so a symlinked parent pointing outside denies without touching it;
 * the final component is NOT resolved here — the open below uses
 * `O_NOFOLLOW`, so a symlinked final component fails closed.
 */
export async function resolveWriteTarget(
  target: string,
  root: string,
  cwd: string = process.cwd(),
): Promise<{ canonicalRoot: string; resolved: string }> {
  const canonicalRoot = await canonicalSandboxRoot(root);
  const resolved = resolve(cwd, target);
  let realParent: string;
  try {
    realParent = await realpath(dirname(resolved));
  } catch {
    throw new SandboxDenied(target, canonicalRoot);
  }
  if (!insideRoot(canonicalRoot, realParent)) throw new SandboxDenied(target, canonicalRoot);
  return { canonicalRoot, resolved: join(realParent, basename(resolved)) };
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

/** Test seam: runs after the target directory is validated and before the file is opened. */
export interface ConfinedWriteSteps {
  readonly beforeOpen?: () => Promise<void>;
}

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

async function nearestExistingAncestor(
  directory: string,
): Promise<{ real: string; missing: string[] } | undefined> {
  const missing: string[] = [];
  let current = directory;
  for (;;) {
    try {
      return { real: await realpath(current), missing };
    } catch (error) {
      if (errorCode(error) !== "ENOENT" || dirname(current) === current) return undefined;
      missing.unshift(basename(current));
      current = dirname(current);
    }
  }
}

async function rejectUnsafeExistingTarget(file: string, deny: () => SandboxDenied): Promise<void> {
  const existing = await lstat(file).catch(() => undefined);
  if (!existing) return;
  if (existing.isSymbolicLink()) throw deny();
  if (!existing.isFile() && !existing.isDirectory()) throw deny();
}

async function createMissingDirectories(
  realAncestor: string,
  missing: readonly string[],
  canonicalRoot: string,
  deny: () => SandboxDenied,
): Promise<string> {
  let current = realAncestor;
  for (const segment of missing) {
    const next = join(current, segment);
    await mkdir(next).catch((error: unknown) => {
      if (errorCode(error) !== "EEXIST") throw error;
    });
    current = await realpath(next).catch(() => {
      throw deny();
    });
    if (!insideRoot(canonicalRoot, current)) throw deny();
  }
  return current;
}

async function openWithoutTruncating(
  file: string,
  deny: () => SandboxDenied,
): Promise<{ handle: FileHandle; created: boolean }> {
  const flags = constants.O_WRONLY | constants.O_NOFOLLOW;
  try {
    return { handle: await open(file, flags | constants.O_CREAT | constants.O_EXCL, 0o666), created: true };
  } catch (error) {
    if (errorCode(error) === "ELOOP") throw deny();
    if (errorCode(error) !== "EEXIST") throw error;
  }
  try {
    return { handle: await open(file, flags), created: false };
  } catch (error) {
    if (errorCode(error) === "ELOOP") throw deny();
    throw error;
  }
}

async function assertOpenedFileStillConfined(
  handle: FileHandle,
  file: string,
  canonicalRoot: string,
  deny: () => SandboxDenied,
): Promise<void> {
  const [opened, current, realParent] = await Promise.all([
    handle.stat(),
    lstat(file).catch(() => undefined),
    realpath(dirname(file)).catch(() => undefined),
  ]);
  if (!opened.isFile() || current === undefined || !sameFile(opened, current)) throw deny();
  if (realParent === undefined || !insideRoot(canonicalRoot, realParent)) throw deny();
}

async function removeCreatedFile(handle: FileHandle, file: string): Promise<void> {
  const opened = await handle.stat().catch(() => undefined);
  const current = await lstat(file).catch(() => undefined);
  if (opened && current && sameFile(opened, current)) await unlink(file).catch(() => undefined);
}

/**
 * Best-effort confined write for the in-process `write` and `edit` tools. Validates before it
 * creates: the nearest existing ancestor must resolve inside the canonical root, missing
 * directories are made one segment at a time and re-validated, and the file is opened with
 * `O_NOFOLLOW` without truncating. Only after the opened handle matches the path and its parent
 * still resolves inside the root is the file truncated and written. A file this call created is
 * removed again when the write is denied or fails. Not race-free: Node has no `openat`, so a
 * swap of an intermediate directory between validation and open is only caught by the recheck.
 */
export async function confinedWriteFile(
  target: string,
  content: string | Uint8Array,
  root: string,
  cwd: string = process.cwd(),
  steps: ConfinedWriteSteps = {},
): Promise<void> {
  const canonicalRoot = await canonicalSandboxRoot(root);
  const deny = () => new SandboxDenied(target, canonicalRoot);
  const resolved = resolve(cwd, target);
  const ancestor = await nearestExistingAncestor(dirname(resolved));
  if (!ancestor || !insideRoot(canonicalRoot, ancestor.real)) throw deny();
  if (ancestor.missing.length === 0)
    await rejectUnsafeExistingTarget(join(ancestor.real, basename(resolved)), deny);
  const parent = await createMissingDirectories(ancestor.real, ancestor.missing, canonicalRoot, deny);
  await steps.beforeOpen?.();
  const file = join(parent, basename(resolved));
  const { handle, created } = await openWithoutTruncating(file, deny);
  try {
    await assertOpenedFileStillConfined(handle, file, canonicalRoot, deny);
    await handle.truncate(0);
    await handle.writeFile(content);
  } catch (error) {
    if (created) await removeCreatedFile(handle, file);
    throw error;
  } finally {
    await handle.close().catch(() => undefined);
  }
}
