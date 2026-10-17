import { homedir } from "node:os";

const isHomeShortcut = (path: string) => path === "~" || path.startsWith("~/");

/** Replaces a leading `~` or `~/` with the home folder; every other path is returned as it is. */
export function expandHome(path: string): string {
  return isHomeShortcut(path) ? `${homedir()}${path.slice(1)}` : path;
}

/** The inverse, for display: a path inside the home folder starts with `~`. */
export function collapseHome(path: string): string {
  const home = homedir();
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
