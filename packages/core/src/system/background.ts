import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import {
  type Binaries,
  findOnPath,
  type HostPlatform,
  hostPlatform,
  resolveBinaries,
} from "../processes/governor/wrap-command";

export interface BackgroundCommand {
  readonly file: string;
  readonly args: readonly string[];
}

const isExecutable = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** No fallback directories: mirrors exactly what the child would resolve. */
const findOnExplicitPath = (name: string, path: string): string | undefined => {
  const folders = new Set(path.split(delimiter).filter(Boolean));
  for (const folder of folders) {
    const candidate = join(folder, name);
    if (isExecutable(candidate)) return candidate;
  }
  return undefined;
};

export const prefixFor = (
  platform: HostPlatform,
  binaries: Binaries,
  chrtUsable = true,
): readonly string[] => {
  if (platform === "macos") return binaries.taskpolicy ? [binaries.taskpolicy, "-b"] : [];
  if (platform !== "linux") return [];
  if (binaries.chrt && chrtUsable) return [binaries.chrt, "-i", "0"];
  if (binaries.nice) return [binaries.nice, "-n", "19"];
  return [];
};

/** Presence is not usability: a locked-down container can refuse the scheduler change. */
export const probeChrt = (chrt: string, sh: string): boolean => {
  try {
    return spawnSync(chrt, ["-i", "0", sh, "-c", ":"], { timeout: 2000 }).status === 0;
  } catch {
    return false;
  }
};

let cached: readonly string[] | undefined;
let cachedChrtUsable: boolean | undefined;

export const backgroundPrefix = (opts?: { readonly chrtProbe?: typeof probeChrt }): readonly string[] => {
  if (cached) return cached;
  const platform = hostPlatform();
  const binaries = resolveBinaries(platform);
  if (platform === "linux" && binaries.chrt) {
    cachedChrtUsable ??= (opts?.chrtProbe ?? probeChrt)(binaries.chrt, binaries.sh ?? "/bin/sh");
  }
  cached = prefixFor(platform, binaries, cachedChrtUsable ?? true);
  return cached;
};

/** Test seam: forget the cached prefix so the next call re-resolves. */
export const resetBackgroundCache = () => {
  cached = undefined;
  cachedChrtUsable = undefined;
};

export const withPrefix = (
  prefix: readonly string[],
  file: string,
  args: readonly string[],
  path?: string,
): BackgroundCommand => {
  if (prefix.length === 0) return { file, args };
  if (file.includes("/")) {
    if (!isExecutable(file)) return { file, args };
  } else if (path === undefined) {
    if (!findOnPath(file, process.env.PATH ?? "")) return { file, args };
  } else if (!findOnExplicitPath(file, path)) {
    return { file, args };
  }
  const [head, ...rest] = prefix;
  return { file: head as string, args: [...rest, file, ...args] };
};

export const withBackground = (file: string, args: readonly string[], path?: string): BackgroundCommand =>
  withPrefix(backgroundPrefix(), file, args, path);
