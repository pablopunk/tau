import type { ConversationSummary } from "@tau/protocol";
import { CliExit, usageError } from "./cli-exit";
import { callRoute, discoverServer, type Server } from "./client";
import { type CommandEnv, processEnv } from "./command-env";
import { helpText } from "./help";
import { assertNotOwnLineage, GUARDED_COMMANDS } from "./own-thread";
import { findCommand, type ParsedCommand, parseCommand } from "./parse";
import { EXTRA_THREAD_VERBS, runThreadExtra } from "./thread-extras";
import { runEndedAtOf, waitForThread } from "./wait";

const wantsHelp = (argv: readonly string[]) => argv.includes("--help") || argv.includes("-h");

const printJson = (env: CommandEnv, result: unknown) =>
  env.stdout(JSON.stringify(result === undefined ? { ok: true } : result, null, 2));

async function guardDestructive(server: Server, env: CommandEnv, parsed: ParsedCommand): Promise<void> {
  const id = parsed.input.params.id;
  if (id !== undefined && GUARDED_COMMANDS.includes(parsed.def.command)) {
    await assertNotOwnLineage(server, env, parsed.def.command, id);
  }
}

async function runWithWait(server: Server, env: CommandEnv, parsed: ParsedCommand): Promise<void> {
  const isStart = parsed.def.command === "threads start";
  const knownId = parsed.input.params.id;
  const needsR0 = parsed.wait && !isStart && knownId !== undefined;
  const endedAfter = needsR0 ? await runEndedAtOf(server, env, knownId) : null;
  const result = await callRoute(server, parsed.def.route, parsed.input, env);
  printJson(env, result);
  if (!parsed.wait) return;
  const conversationId = knownId ?? (result as ConversationSummary).id;
  const answer = await waitForThread(server, env, {
    conversationId,
    endedAfter,
    timeoutSeconds: parsed.timeoutSeconds,
  });
  env.stdout(`\n${answer}`);
}

/** Runs one API command and throws `CliExit` on any failure. Testable with an injected env. */
export async function executeApiCommand(
  noun: string,
  argv: readonly string[],
  env: CommandEnv,
): Promise<void> {
  const verb = argv[0]?.startsWith("-") ? undefined : argv[0];
  if (verb === undefined || wantsHelp(argv)) return env.stdout(helpText(noun, verb));
  if (noun === "threads" && EXTRA_THREAD_VERBS.includes(verb))
    return runThreadExtra(verb, argv.slice(1), env);
  const parsed = parseCommand(findCommand(noun, verb), argv.slice(1));
  if (parsed.def.destructive && !parsed.yes) {
    throw usageError(`tau ${parsed.def.command} is destructive. Add --yes to confirm.`);
  }
  const scoped = parsed.home === undefined ? env : { ...env, home: parsed.home };
  const server = await discoverServer(scoped);
  await guardDestructive(server, scoped, parsed);
  await runWithWait(server, scoped, parsed);
}

/** The `tau <noun> …` entry point. `argv` starts after the noun. */
export async function runApiCommand(noun: string, argv: readonly string[]): Promise<void> {
  const env = processEnv();
  try {
    await executeApiCommand(noun, argv, env);
  } catch (error) {
    if (!(error instanceof CliExit)) throw error;
    env.stderr(error.message);
    process.exitCode = error.exitCode;
  }
}
