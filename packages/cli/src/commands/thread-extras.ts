import { usageError } from "./cli-exit";
import { discoverServer } from "./client";
import type { CommandEnv } from "./command-env";
import { DEFAULT_TIMEOUT_SECONDS } from "./parse";
import { readThread } from "./read";
import { type FlagSpec, scanArgs } from "./scan-args";
import { waitForThread } from "./wait";

export const EXTRA_THREAD_VERBS: readonly string[] = ["wait", "read"];

function positiveNumber(raw: string | boolean | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (typeof raw === "boolean" || !(value > 0)) throw usageError(`--${flag} needs a positive number`);
  return value;
}

function threadIdOf(verb: string, positionals: readonly string[]): string {
  if (positionals.length !== 1) throw usageError(`Usage: tau threads ${verb} <id>`);
  return positionals[0] as string;
}

/** `tau threads wait <id> [--timeout s]` and `tau threads read <id> [--last N]`. They are not routes. */
export async function runThreadExtra(verb: string, argv: readonly string[], env: CommandEnv): Promise<void> {
  const spec: FlagSpec =
    verb === "wait" ? { timeout: "value", home: "value" } : { last: "value", home: "value" };
  const { positionals, flags } = scanArgs(argv, spec);
  const id = threadIdOf(verb, positionals);
  const home = flags.get("home");
  const scoped = typeof home === "string" ? { ...env, home } : env;
  const server = await discoverServer(scoped);
  if (verb === "read") {
    const last = positiveNumber(flags.get("last"), "last");
    env.stdout(await readThread(server, scoped, id, last));
    return;
  }
  const timeoutSeconds = positiveNumber(flags.get("timeout"), "timeout") ?? DEFAULT_TIMEOUT_SECONDS;
  env.stdout(
    await waitForThread(server, scoped, { conversationId: id, endedAfter: undefined, timeoutSeconds }),
  );
}
