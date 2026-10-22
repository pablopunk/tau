import { join } from "node:path";

/** Seatbelt strings escape backslash and double-quote; everything else is literal. */
export function escapeSeatbelt(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export interface SeatbeltInput {
  /** Canonical worktree root. Writes are confined here. */
  readonly root: string;
  /** Extra writable subpaths: the thread's git allowlist (admin dir, shared objects, own ref). */
  readonly extraWritePaths?: readonly string[];
}

const quote = (value: string) => `"${escapeSeatbelt(value)}"`;

/**
 * macOS `/tmp` is a symlink to `/private/tmp`: a profile ruling on one spelling
 * leaves the other open, so both spellings join the allowlist when applicable.
 */
export function privateAlias(root: string): string | undefined {
  if (root === "/tmp") return "/private/tmp";
  return root.startsWith("/tmp/") ? `/private${root}` : undefined;
}

/**
 * Seatbelt profile text for one worktree root. First matching rule wins, so the
 * inside-allowlist comes first, then a blanket write-deny, then the default
 * allow for reads/exec/stdio. No `network*` rule in v1.
 *
 * Deliberately NO `(deny signal)`: a blanket signal deny breaks children
 * signaling children (shell `kill`, `timeout`, test runners). Inside→outside
 * kills are an accepted residual risk (see §Signal scope).
 */
export function buildSeatbeltProfile(input: SeatbeltInput): string {
  const subpaths = [input.root, privateAlias(input.root), ...(input.extraWritePaths ?? [])].filter(
    (path): path is string => path !== undefined,
  );
  const unique = [...new Set(subpaths)];
  const allowInner = [...unique.map((path) => `(subpath ${quote(path)})`), `(literal "/dev/null")`].join(" ");
  return (
    [`(version 1)`, `(allow file-write* ${allowInner})`, `(deny file-write*)`, `(allow default)`].join("\n") +
    "\n"
  );
}

/** Where caches redirect so tools keep working without writing outside the root. */
export const cacheDirFor = (root: string) => join(root, ".tau-caches");
