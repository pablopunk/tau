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
  kill(pid: number, signal?: NodeJS.Signals): void;
  /** Resolves after `ms`; fakes resolve at once. */
  sleep(ms: number): Promise<void>;
  /** The command line of a process (`ps -o command=`, then `-o args=`); undefined when empty or failed. */
  commandOf(pid: number): Promise<string | undefined>;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function psField(pid: number, field: "command" | "args"): Promise<string | undefined> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile("ps", ["-o", `${field}=`, "-p", String(pid)], (error, stdout) => {
      const text = error ? "" : stdout.trim();
      resolve(text === "" ? undefined : text);
    });
  });
}

async function commandOf(pid: number): Promise<string | undefined> {
  if (process.platform === "win32") return undefined;
  return (await psField(pid, "command")) ?? (await psField(pid, "args"));
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
    kill: (pid, signal = "SIGTERM") => process.kill(pid, signal),
    sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    commandOf: (pid) => commandOf(pid),
  };
}
