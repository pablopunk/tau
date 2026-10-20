import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import type { ResourcePriority } from "@tau/protocol";

export type HostPlatform = "macos" | "linux" | "other";

export const hostPlatform = (platform: NodeJS.Platform = process.platform): HostPlatform =>
  platform === "darwin" ? "macos" : platform === "linux" ? "linux" : "other";

export interface Binaries {
  readonly taskpolicy?: string;
  readonly nice?: string;
  readonly chrt?: string;
  readonly sh?: string;
  readonly systemdRun?: string;
}

export interface WrapSupport {
  readonly platform: HostPlatform;
  readonly binaries: Binaries;
  /** A passing probe: a scope with `MemoryMax` works. */
  readonly cgroupMemory: boolean;
}

export interface Wrapped {
  readonly file: string;
  readonly args: readonly string[];
}

export interface WrapInput {
  /** This command's scope level: the one knob that differs per thread. */
  readonly priority: ResourcePriority;
  /** Every governed command gets the same cap; tests shrink it. */
  readonly memoryLimitMb: number;
  readonly support: WrapSupport;
  readonly shell: string;
  readonly command: string;
  /** `tau-<nodeId>-<entryId>`: names the scope when the memory limit uses one. */
  readonly unit?: string;
}

export const TASKPOLICY = "/usr/sbin/taskpolicy";
/**
 * `$1` chrt, `$2` nice, `$3` the shell, absolute when resolved: `chrt` execs its program through PATH, so even the
 * `true` probe needs an absolute program (the shell) to work under a minimal PATH.
 */
export const BACKGROUND_CHRT =
  'chrt=$1; nice=$2; sh=$3; shift 3; "$chrt" -i 0 "$sh" -c : 2>/dev/null && exec "$chrt" -i 0 "$@" || exec "$nice" -n 19 "$@"';

const isExecutable = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Synchronous PATH scan, with `/usr/bin` and `/bin` added when the PATH is short (launchd, GUI starts). */
export function findOnPath(name: string, path: string = process.env.PATH ?? ""): string | undefined {
  const folders = [...path.split(delimiter).filter(Boolean), "/usr/bin", "/bin"];
  for (const folder of new Set(folders)) {
    const candidate = join(folder, name);
    if (isExecutable(candidate)) return candidate;
  }
  return undefined;
}

export function resolveBinaries(platform: HostPlatform, path?: string): Binaries {
  if (platform === "macos") return isExecutable(TASKPOLICY) ? { taskpolicy: TASKPOLICY } : {};
  if (platform !== "linux") return {};
  const find = (name: string) => findOnPath(name, path);
  const found = { nice: find("nice"), chrt: find("chrt"), sh: find("sh"), systemdRun: find("systemd-run") };
  return Object.fromEntries(Object.entries(found).filter(([, value]) => value !== undefined)) as Binaries;
}

function priorityPrefix(priority: ResourcePriority, support: WrapSupport): string[] {
  const { binaries, platform } = support;
  if (priority === "off") return [];
  if (platform === "macos") {
    if (!binaries.taskpolicy) return [];
    return priority === "balanced" ? [binaries.taskpolicy, "-c", "utility"] : [binaries.taskpolicy, "-b"];
  }
  if (platform !== "linux") return [];
  if (priority === "balanced") return binaries.nice ? [binaries.nice, "-n", "5"] : [];
  if (!binaries.sh) return [];
  return [
    binaries.sh,
    "-c",
    BACKGROUND_CHRT,
    "_",
    binaries.chrt ?? "chrt",
    binaries.nice ?? "nice",
    binaries.sh,
  ];
}

function scopePrefix({ memoryLimitMb, support, unit }: WrapInput): string[] {
  if (unit === undefined) return [];
  if (support.platform !== "linux" || !support.cgroupMemory || !support.binaries.systemdRun) return [];
  return [
    support.binaries.systemdRun,
    "--user",
    "--scope",
    "--quiet",
    `--unit=${unit}`,
    "-p",
    `MemoryMax=${memoryLimitMb}M`,
    "-p",
    "MemorySwapMax=0",
    "--",
  ];
}

export const usesScope = (input: WrapInput) => scopePrefix(input).length > 0;

/** `null` when no control that needs wrapping is on; the shell is exec'd so the spawned pid leads the group. */
export function wrapCommand(input: WrapInput): Wrapped | null {
  const prefix = [...scopePrefix(input), ...priorityPrefix(input.priority, input.support)];
  const [file, ...rest] = prefix;
  if (file === undefined) return null;
  return { file, args: [...rest, input.shell, "-c", input.command] };
}
