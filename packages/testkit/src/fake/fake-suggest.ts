import type { PathSuggestion, SuggestDirectoriesInput } from "@tau/protocol";
import { expandFakeHome, FAKE_HOME_PATH, type FakeFs, normalizePath } from "./fake-fs";

const DEFAULT_LIMIT = 50;

const absoluteOf = (prefix: string) => {
  const expanded = expandFakeHome(prefix === "~" ? "~/" : prefix);
  return expanded.startsWith("/") ? expanded : `${FAKE_HOME_PATH}/${expanded}`;
};

const displayOf = (path: string) =>
  path === FAKE_HOME_PATH
    ? "~"
    : path.startsWith(`${FAKE_HOME_PATH}/`)
      ? `~${path.slice(FAKE_HOME_PATH.length)}`
      : path;

export function suggestFakeDirectories(fs: FakeFs, input: SuggestDirectoriesInput): PathSuggestion[] {
  const absolute = absoluteOf(input.prefix);
  const slash = absolute.lastIndexOf("/");
  const parent = normalizePath(absolute.slice(0, slash + 1));
  const partial = absolute.slice(slash + 1).toLowerCase();
  const prefix = parent === "/" ? "/" : `${parent}/`;
  return Object.entries(fs)
    .filter(([path, kind]) => kind === "directory" && path.startsWith(prefix))
    .map(([path]) => ({ path, name: path.slice(prefix.length) }))
    .filter(({ name }) => name !== "" && !name.includes("/") && name.toLowerCase().startsWith(partial))
    .filter(({ name }) => !name.startsWith(".") || partial.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, input.limit ?? DEFAULT_LIMIT)
    .map(({ path }) => ({ path, display: displayOf(path), isGitRepo: fs[`${path}/.git`] === "directory" }));
}
