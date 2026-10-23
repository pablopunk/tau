import { type ConversationSummary, commands, routes } from "@tau/protocol";
import { CliExit, usageError } from "./cli-exit";
import { callRoute, discoverServer, type Server } from "./client";
import { type CommandEnv, processEnv } from "./command-env";
import { commandFlags } from "./command-flags";
import { helpText } from "./help";
import { MachineOutput } from "./machine-output";
import { NODE_GROUP_COMMANDS, runNodeGroupCommand } from "./node-group-commands";
import { takeContextFlags } from "./node-target";
import { assertNotOwnLineage, GUARDED_COMMANDS } from "./own-thread";
import { findCommandIn, type ParsedCommand, parseCommand } from "./parse";
import { runTerminalAttach } from "./terminal-command";
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
  const body = parsed.input.body as { requestId?: string } | undefined;
  const path = routes[parsed.def.route].path;
  const isThreadRoute = path.includes("/conversations/:id");
  const isTerminalRoute = path.includes("/terminals/:id");
  env.machine?.identify({
    threadId: isThreadRoute ? (knownId ?? null) : null,
    terminalId: isTerminalRoute ? (knownId ?? null) : null,
    requestId: body?.requestId ?? null,
  });
  const result = await callRoute(server, parsed.def.route, parsed.input, env);
  if (env.machine) {
    const receipt = result as { id?: string; submissionId?: number; entryId?: number } | undefined;
    env.machine.identify({
      threadId: isStart ? (receipt?.id ?? null) : isThreadRoute ? (knownId ?? null) : null,
      terminalId:
        parsed.def.route === "openTerminal"
          ? (receipt?.id ?? null)
          : isTerminalRoute
            ? (knownId ?? null)
            : null,
      requestId: body?.requestId ?? null,
      submissionId: receipt?.submissionId ?? null,
      entryId: receipt?.entryId ?? null,
    });
    env.machine.emit(isStart || parsed.def.command === "threads send" ? "receipt" : "terminal", {
      result: result ?? { ok: true },
      observation: "response",
    });
  } else printJson(env, result);
  if (!parsed.wait) return;
  const conversationId = knownId ?? (result as ConversationSummary).id;
  const answer = await waitForThread(server, env, {
    conversationId,
    endedAfter,
    timeoutSeconds: parsed.timeoutSeconds,
  });
  if (!env.machine) env.stdout(`\n${answer}`);
}

/** Runs one API command and throws `CliExit` on any failure. Testable with an injected env. */
async function executeScopedCommand(noun: string, argv: readonly string[], env: CommandEnv): Promise<void> {
  const verb = argv[0]?.startsWith("-") ? undefined : argv[0];
  if (verb === undefined || wantsHelp(argv)) return env.stdout(helpText(noun, verb));
  if (noun === "terminals" && verb === "attach") return runTerminalAttach(argv.slice(1), env);
  if (noun === "settings" && verb === "discover") {
    const result = {
      version: 1,
      commands: commands.map((def) => ({
        ...def,
        flags: commandFlags(def),
        request: routes[def.route],
        confirmation:
          def.command === "nodes remove"
            ? { flag: "confirm", kind: "typed-name-or-id", yesSufficient: false }
            : { flag: def.destructive ? "yes" : null },
        actualRoute: def.command === "nodes list" ? "getNodeDirectory" : def.route,
      })),
      specialCommands: [
        { command: "threads read", positionals: ["threadId"], flags: ["last"], observation: "response" },
        {
          command: "threads wait",
          positionals: ["threadId"],
          flags: ["timeout"],
          observation: "thread-idle",
        },
        {
          command: "threads handoff",
          positionals: ["threadId"],
          flags: ["instruction", "request-id", "yes"],
          withoutYes: "preview-only",
        },
        {
          command: "terminals attach",
          positionals: ["terminalId"],
          flags: ["cols", "rows"],
          stdin: "NDJSON base64 input or protocol resize",
          eof: "detach",
          sigintExit: 130,
        },
        { command: "metrics", json: "legacy-output", flags: ["machine", "node", "home"] },
        {
          command: "connect",
          node: "URL, not generic node selector",
          confirmation: "explicit --yes in machine mode",
          result: "local link storage only; handshake unknown",
        },
      ],
      machine: "NDJSON v1",
      nodeSelector: "stable node ID",
      waitObservation: "thread-idle",
    };
    if (env.machine) env.machine.emit("terminal", { result, observation: "response" });
    else printJson(env, result);
    return;
  }
  if (noun === "threads" && EXTRA_THREAD_VERBS.includes(verb))
    return runThreadExtra(verb, argv.slice(1), env);
  const { def, words } = findCommandIn(noun, argv);
  if (NODE_GROUP_COMMANDS.includes(def.command))
    return runNodeGroupCommand(def.command, argv.slice(words), env);
  const parsed = parseCommand(def, argv.slice(words));
  if (parsed.def.destructive && !parsed.yes) {
    throw usageError(`tau ${parsed.def.command} is destructive. Add --yes to confirm.`);
  }
  const scoped = parsed.home === undefined ? env : { ...env, home: parsed.home };
  const server = await discoverServer(scoped);
  await guardDestructive(server, scoped, parsed);
  await runWithWait(server, scoped, parsed);
}

/** Context is fixed before any route, manual override, or stream is opened. */
export async function executeApiCommand(
  noun: string,
  argv: readonly string[],
  env: CommandEnv,
): Promise<void> {
  const machine = argv.includes("--machine")
    ? new MachineOutput(env, `${noun} ${argv.find((word) => !word.startsWith("-")) ?? ""}`)
    : undefined;
  try {
    const context = takeContextFlags(argv);
    const { home, rest } = takeHomeFlag(context.rest);
    const scoped: CommandEnv = {
      ...env,
      machine,
      nodeId: context.nodeId,
      ...(home === undefined ? {} : { home }),
    };
    if (wantsHelp(rest) || rest.length === 0) return executeScopedCommand(noun, rest, scoped);
    machine?.identify({ nodeId: context.nodeId ?? null });
    await executeScopedCommand(noun, rest, scoped);
  } catch (error) {
    if (machine) throw machine.fail(error);
    throw error;
  }
}

/** `--home` may come before the verb (`tau --home X threads list`); it is lifted out of argv. */
export function takeHomeFlag(argv: readonly string[]): { home: string | undefined; rest: string[] } {
  const rest: string[] = [];
  let home: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] as string;
    if (token === "--") {
      rest.push(...argv.slice(index));
      break;
    }
    if (token === "--home" && argv[index + 1] !== undefined) home = argv[++index];
    else if (token.startsWith("--home=")) home = token.slice("--home=".length);
    else rest.push(token);
  }
  return { home, rest };
}

/** The `tau <noun> …` entry point. `argv` starts after the noun. */
export async function runApiCommand(noun: string, argv: readonly string[]): Promise<void> {
  const env = processEnv();
  try {
    const { home, rest } = takeHomeFlag(argv);
    await executeApiCommand(noun, rest, home === undefined ? env : { ...env, home });
  } catch (error) {
    if (!(error instanceof CliExit)) throw error;
    env.stderr(error.message);
    process.exitCode = error.exitCode;
  }
}
