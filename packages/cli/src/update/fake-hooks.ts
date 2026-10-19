import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { sep } from "node:path";

function realOrSame(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The e2e hooks (`TAU_FAKE_LATEST`, `TAU_FAKE_UPDATE`) only work for a home under the temp dir. */
export function fakeHooksAllowed(home: string | undefined, temp: string = tmpdir()): boolean {
  if (!home) return false;
  const inside = (path: string, root: string) => path === root || path.startsWith(root + sep);
  return [home, realOrSame(home)].some((h) => [temp, realOrSame(temp)].some((root) => inside(h, root)));
}
