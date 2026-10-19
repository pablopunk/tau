import { homedir, release, userInfo } from "node:os";
import { join } from "node:path";
import { type Runner, realRunner } from "./runner";

/** Everything the service code reads from the node, so tests can fake it. */
export interface ServiceContext {
  readonly platform: NodeJS.Platform;
  readonly uid: number;
  readonly username: string;
  readonly osHome: string;
  readonly defaultHome: string;
  readonly xdgRuntimeDir: string | undefined;
  readonly windowsBuild: number | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly runner: Runner;
  isAlive(pid: number): boolean;
  kill(pid: number): void;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const windowsBuildOf = (): number | undefined =>
  process.platform === "win32" ? Number(release().split(".")[2]) : undefined;

export function realContext(env: NodeJS.ProcessEnv = process.env): ServiceContext {
  return {
    platform: process.platform,
    uid: process.getuid?.() ?? 0,
    username: userInfo().username,
    osHome: homedir(),
    defaultHome: join(homedir(), ".tau"),
    xdgRuntimeDir: env.XDG_RUNTIME_DIR,
    windowsBuild: windowsBuildOf(),
    env,
    runner: realRunner,
    isAlive,
    kill: (pid) => process.kill(pid, "SIGTERM"),
  };
}
