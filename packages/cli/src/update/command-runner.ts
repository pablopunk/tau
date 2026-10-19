import { spawn } from "node:child_process";

export interface CommandResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** `inherit`: all stdio inherited. `tee`: stdout inherited, stderr shown and captured. `capture`: nothing shown. */
export interface RunOptions {
  readonly stdio: "inherit" | "tee" | "capture";
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
}

export type RunCommand = (
  command: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<CommandResult>;

/** Spawns with an args array and no shell. A missing binary is a result with `code: null`. */
export const spawnCommand: RunCommand = (command, args, options) =>
  new Promise((resolve) => {
    const child = spawn(command, [...args], {
      env: options.env ?? process.env,
      stdio:
        options.stdio === "inherit"
          ? "inherit"
          : ["inherit", options.stdio === "tee" ? "inherit" : "pipe", "pipe"],
      timeout: options.timeoutMs,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (options.stdio === "tee") process.stderr.write(chunk);
    });
    child.on("error", (error) => resolve({ code: null, stdout, stderr: stderr + error.message }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
