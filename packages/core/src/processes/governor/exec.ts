import { execFile } from "node:child_process";

export interface ExecResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface ExecOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
}

export type Exec = (file: string, args: readonly string[], options?: ExecOptions) => Promise<ExecResult>;

export const execCommand: Exec = (file, args, options = {}) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        env: options.env ?? process.env,
        ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const failure = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        resolve({
          code: failure === null ? 0 : typeof failure.code === "number" ? failure.code : null,
          stdout,
          stderr,
          timedOut: failure?.killed === true,
        });
      },
    );
  });

/** The session bus variables systemd-run and systemctl need, filled in when tau's own environment lacks them. */
export function systemdEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const runtime = env.XDG_RUNTIME_DIR ?? `/run/user/${uid}`;
  return {
    XDG_RUNTIME_DIR: runtime,
    DBUS_SESSION_BUS_ADDRESS: env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=${runtime}/bus`,
  };
}
