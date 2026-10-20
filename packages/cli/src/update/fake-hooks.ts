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

/** The e2e hooks (`TAU_FAKE_LATEST`, `TAU_FAKE_UPDATE`, `TAU_RELEASES_API`) only work for a home under the temp dir. */
export function fakeHooksAllowed(home: string | undefined, temp: string = tmpdir()): boolean {
  if (!home) return false;
  const inside = (path: string, root: string) => path === root || path.startsWith(root + sep);
  return [home, realOrSame(home)].some((h) => [temp, realOrSame(temp)].some((root) => inside(h, root)));
}

/** `TAU_RELEASES_API` (e2e): a local server standing in for the GitHub releases API. Same temp-home rule. */
export function releasesApiOf(
  home: string | undefined,
  real: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fake = env.TAU_RELEASES_API;
  return fake && fakeHooksAllowed(home) ? fake : real;
}

/** `TAU_FAKE_VERSION` (e2e): the version this tau reports as its own, so a fake update can change it. Same temp-home rule. */
export function versionOf(
  real: string,
  home: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fake = env.TAU_FAKE_VERSION;
  return fake && fakeHooksAllowed(home) ? fake : real;
}
