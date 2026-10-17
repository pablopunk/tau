import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { AppError } from "@pi-everywhere/protocol";
import { expandHome } from "./fs/expand-home";

/** The real path of an existing directory, `~` allowed; rejects `invalid_request`, `path_not_found` or `not_a_directory`. */
export async function resolveProjectFolder(typedPath: string): Promise<string> {
  const path = expandHome(typedPath);
  if (!isAbsolute(path)) throw new AppError("invalid_request", "The folder path must be absolute.");
  const real = await realpath(path).catch(() => {
    throw new AppError("path_not_found", "This folder does not exist.");
  });
  if (!(await stat(real)).isDirectory()) throw new AppError("not_a_directory", "This path is not a folder.");
  return real;
}
