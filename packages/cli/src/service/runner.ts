import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  /** The environment of the command. Default: `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
}

export interface DetachedOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Stdout and stderr go to this file (truncated) instead of being dropped. */
  readonly logFile?: string;
}

/** Every OS command of the service code goes through this seam. */
export interface Runner {
  run(command: string, args: readonly string[], options?: RunOptions): Promise<CommandResult>;
  /** Starts a process that outlives the CLI; resolves to its pid. */
  spawnDetached(
    command: string,
    args: readonly string[],
    options?: DetachedOptions,
  ): Promise<number | undefined>;
}

export const realRunner: Runner = {
  async run(command, args, options = {}) {
    const result = spawnSync(command, [...args], { encoding: "utf8", env: options.env ?? process.env });
    return {
      code: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? result.error?.message ?? "",
    };
  },
  async spawnDetached(command, args, options = {}) {
    const log = options.logFile === undefined ? undefined : openLog(options.logFile);
    try {
      const child = spawn(command, [...args], {
        detached: true,
        stdio: log === undefined ? "ignore" : ["ignore", log, log],
        windowsHide: true,
        env: options.env ?? process.env,
      });
      child.unref();
      return child.pid;
    } finally {
      if (log !== undefined) closeSync(log);
    }
  },
};

function openLog(file: string): number {
  mkdirSync(dirname(file), { recursive: true });
  return openSync(file, "w", 0o600);
}
