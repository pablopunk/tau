import { accessSync, constants, existsSync } from "node:fs";

/** The port the terminal service uses. It exposes no `@earendil-works/pi-env` type. This is the only file that imports pi-env. */
export interface TerminalPortOptions {
  readonly cwd: string;
  /** The whole environment of the shell (the daemon never inherits tau's). */
  readonly env: Readonly<Record<string, string>>;
  readonly cols: number;
  readonly rows: number;
  /** Raw output chunks in order (arbitrary PTY reads). */
  readonly onData: (bytes: Uint8Array) => void;
}

export interface TerminalForegroundJob {
  readonly pid: number;
  readonly name?: string;
}

export interface TerminalPort {
  write(data: Uint8Array | string): void;
  resize(cols: number, rows: number): void;
  /** Kills the shell and its session. */
  close(): void;
  /** Undefined while the shell itself is in front; rejects once the terminal ended. */
  foreground(): Promise<TerminalForegroundJob | undefined>;
  /** The exit code; `null` after `close()` or when the connection was lost. Never rejects. */
  readonly exited: Promise<number | null>;
}

export interface TerminalDaemon {
  /** False on unsupported platforms, a missing or non-executable daemon file, and `TAU_DISABLE_TERMINALS=1`. Never rejects; loads nothing from pi-env when disabled. */
  available(): Promise<boolean>;
  open(options: TerminalPortOptions): Promise<TerminalPort>;
  /** Stops the daemon, which kills every terminal. Idempotent. */
  close(): Promise<void>;
}

type PiEnv = typeof import("@earendil-works/pi-env");

export function createLocalTerminalDaemon(env: NodeJS.ProcessEnv = process.env): TerminalDaemon {
  let module: Promise<PiEnv> | undefined;
  let connection: InstanceType<PiEnv["Connection"]> | undefined;
  const load = () => {
    module ??= import("@earendil-works/pi-env");
    return module;
  };

  async function binaryUsable(): Promise<boolean> {
    if (env.TAU_DISABLE_TERMINALS === "1") return false;
    try {
      const path = (await load()).localDaemon();
      if (!existsSync(path)) return false;
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  async function open(options: TerminalPortOptions): Promise<TerminalPort> {
    const piEnv = await load();
    connection ??= new piEnv.Connection({ command: [piEnv.localDaemon()] });
    const terminal = await piEnv.openTerminal(connection, {
      cwd: options.cwd,
      env: { ...options.env },
      inheritEnv: false,
      cols: options.cols,
      rows: options.rows,
      onData: options.onData,
    });
    return {
      write: (data) => terminal.write(data),
      resize: (cols, rows) => terminal.resize(cols, rows),
      close: () => terminal.close(),
      foreground: async () => {
        const job = await terminal.foreground();
        return job === undefined ? undefined : { pid: job.pid, name: job.name };
      },
      exited: terminal.exited.then(
        (code) => code,
        () => null,
      ),
    };
  }

  return {
    available: binaryUsable,
    open,
    async close() {
      connection?.close();
      connection = undefined;
    },
  };
}
