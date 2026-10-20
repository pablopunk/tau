import { execFile } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { serverEnvironment } from "./support";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../packages/cli/dist/bin.js", import.meta.url));

export interface RestartableServer {
  readonly home: string;
  /** Runs `tau <args>` against this server's home and returns stdout. */
  tau(...args: string[]): Promise<string>;
  json<T = unknown>(...args: string[]): Promise<T>;
  /** Extra environment for the next `start` (an empty string removes nothing: pass the key with "" to clear it). */
  setEnv(extra: Record<string, string>): void;
  start(): Promise<void>;
  /** Stops the server and starts a new one on the same home: the data stays, the process is new. */
  restart(): Promise<void>;
  stop(): Promise<void>;
}

/** A detached faux server in its own temp home, so a test can kill it and see what survives. Never touches port 4317 or `~/.tau`. */
export function createRestartableServer(options: {
  port: number;
  home?: string;
  env?: Record<string, string>;
  /** The program that runs `tau <args>`: the built CLI under node by default, a compiled binary when given. */
  command?: { file: string; args: string[] };
}): RestartableServer {
  const command = options.command ?? { file: "node", args: [CLI] };
  const home = options.home ?? realpathSync(mkdtempSync(join(tmpdir(), "tau-e2e-restart-")));
  let env: Record<string, string | undefined> = {
    ...process.env,
    ...serverEnvironment(),
    TAU_HOME: home,
    ...options.env,
  };
  const tau = async (...args: string[]) =>
    (await run(command.file, [...command.args, ...args], { env, timeout: 60_000 })).stdout;
  const start = async () => {
    await tau("start", "--faux", "--no-open", "--port", String(options.port));
  };
  const stop = async () => {
    await tau("stop");
  };
  return {
    home,
    tau,
    json: async <T>(...args: string[]) => JSON.parse(await tau(...args)) as T,
    setEnv: (extra) => {
      env = { ...env, ...extra };
    },
    start,
    stop,
    async restart() {
      await stop();
      await start();
    },
  };
}
