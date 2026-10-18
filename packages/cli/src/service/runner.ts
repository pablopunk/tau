import { spawn, spawnSync } from "node:child_process";

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface DetachedOptions {
  readonly env?: NodeJS.ProcessEnv;
}

/** Every OS command of the service code goes through this seam. */
export interface Runner {
  run(command: string, args: readonly string[]): Promise<CommandResult>;
  /** Starts a process that outlives the CLI; resolves to its pid. */
  spawnDetached(
    command: string,
    args: readonly string[],
    options?: DetachedOptions,
  ): Promise<number | undefined>;
}

export const realRunner: Runner = {
  async run(command, args) {
    const result = spawnSync(command, [...args], { encoding: "utf8" });
    return {
      code: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? result.error?.message ?? "",
    };
  },
  async spawnDetached(command, args, options = {}) {
    const child = spawn(command, [...args], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: options.env ?? process.env,
    });
    child.unref();
    return child.pid;
  },
};
