import { isAbsolute, join, relative } from "node:path";
import type { CheckpointsValue } from "./checkpoint-store";

const isInside = (root: string, path: string) => {
  const rel = relative(root, path);
  return !rel.startsWith("..") && !isAbsolute(rel);
};

export const movedPath = (oldRoot: string, newRoot: string, path: string) =>
  path !== "" && isInside(oldRoot, path) ? join(newRoot, relative(oldRoot, path)) : path;

/** Worktree threads keep their root (in tau's home) but share the project's `.git`, so both fields move independently. */
export function relocateDoc(doc: CheckpointsValue, oldRoot: string, newRoot: string): void {
  doc.root = movedPath(oldRoot, newRoot, doc.root);
  doc.gitDir = movedPath(oldRoot, newRoot, doc.gitDir);
}
