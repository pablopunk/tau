import { isAbsolute } from "node:path";
import { AppError } from "@tau/protocol";

/** A path as git prints it: relative to the repository top level, slash separated, never leaving it. */
export function requireRepoRelative(path: string): string {
  const segments = path.split("/");
  const unsafe =
    path === "" || path.includes("\0") || isAbsolute(path) || segments.some((part) => part === "..");
  if (unsafe) throw new AppError("invalid_request", "The path must be relative to the repository.");
  return path;
}
