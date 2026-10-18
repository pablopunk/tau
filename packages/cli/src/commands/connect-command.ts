import { CliExit } from "./cli-exit";
import { type CommandEnv, processEnv } from "./command-env";
import { takeHomeFlag } from "./run-command";

const NOT_BUILT = "This command is not built yet (MVP12 Stage 2, owner I).";

/**
 * STUB for owner I. `tau connect <link> [--name <label>] [--hub <url>] [--yes]`: parse with `parseConnectTarget`,
 * refuse with `connectRefusal(linkedMachines)` and `alreadyLinkedRefusal(hubFile exists)`, print the hub name and ask
 * "Link this machine to <hub>?", redeem with a node `fetch` that sends `Origin: <hubUrl>` and reads `{ secret }`,
 * write `hub.json` through `createHubFileStore`, then start `serve` in the foreground or offer `tau service install`.
 */
export async function executeConnect(_argv: readonly string[], _env: CommandEnv): Promise<void> {
  throw new CliExit(1, NOT_BUILT);
}

/** STUB for owner I. `tau disconnect`: `machines unlink` over loopback, then `hubFile.delete()`. */
export async function executeDisconnect(_argv: readonly string[], _env: CommandEnv): Promise<void> {
  throw new CliExit(1, NOT_BUILT);
}

function runner(execute: (argv: readonly string[], env: CommandEnv) => Promise<void>) {
  return async (argv: readonly string[]): Promise<void> => {
    const env = processEnv();
    try {
      const { home, rest } = takeHomeFlag(argv);
      await execute(rest, home === undefined ? env : { ...env, home });
    } catch (error) {
      if (!(error instanceof CliExit)) throw error;
      env.stderr(error.message);
      process.exitCode = error.exitCode;
    }
  };
}

export const runConnect = runner(executeConnect);
export const runDisconnect = runner(executeDisconnect);
