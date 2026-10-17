import { AppError } from "@pi-everywhere/protocol";

export type FakeFs = Readonly<Record<string, "directory" | "file">>;

export const FAKE_HOME_PATH = "/Users/demo";

export const FAKE_FS: FakeFs = {
  [FAKE_HOME_PATH]: "directory",
  "/Users/demo/project": "directory",
  "/Users/demo/other": "directory",
  "/Users/demo/notes.txt": "file",
  "/Users/demo/src": "directory",
  "/Users/demo/src/pi-everywhere": "directory",
  "/Users/demo/src/pi-everywhere/.git": "directory",
  "/Users/demo/src/sandbox": "directory",
  "/Users/demo/src/scratch": "directory",
  "/Users/demo/Documents": "directory",
};

export function normalizePath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export function expandFakeHome(path: string): string {
  if (path === "~") return FAKE_HOME_PATH;
  return path.startsWith("~/") ? `${FAKE_HOME_PATH}${path.slice(1)}` : path;
}

export function baseName(path: string): string {
  return normalizePath(path).split("/").pop() ?? path;
}

export function assertDirectory(fs: FakeFs, path: string): string {
  const normalized = normalizePath(expandFakeHome(path));
  const kind = fs[normalized];
  if (!kind) throw new AppError("path_not_found", `No such folder: ${path}`);
  if (kind !== "directory") throw new AppError("not_a_directory", `Not a folder: ${path}`);
  return normalized;
}
