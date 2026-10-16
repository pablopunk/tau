import { AppError } from "@pi-everywhere/protocol";

export type FakeFs = Readonly<Record<string, "directory" | "file">>;

export const FAKE_FS: FakeFs = {
  "/Users/demo/project": "directory",
  "/Users/demo/other": "directory",
  "/Users/demo/notes.txt": "file",
};

export function normalizePath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export function baseName(path: string): string {
  return normalizePath(path).split("/").pop() ?? path;
}

export function assertDirectory(fs: FakeFs, path: string): string {
  const normalized = normalizePath(path);
  const kind = fs[normalized];
  if (!kind) throw new AppError("path_not_found", `No such folder: ${path}`);
  if (kind !== "directory") throw new AppError("not_a_directory", `Not a folder: ${path}`);
  return normalized;
}
