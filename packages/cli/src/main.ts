import { COMMAND_NOUNS } from "@tau/protocol";
import { runConnect, runDisconnect } from "./commands/connect-command";
import { runHelp } from "./commands/help";
import { runPair } from "./commands/pair-command";
import { runApiCommand } from "./commands/run-command";
import { runSkill } from "./commands/skill";
import { runBare } from "./lifecycle/bare";
import { runLogs } from "./lifecycle/logs";
import { runOpen } from "./lifecycle/open";
import { runRestart } from "./lifecycle/restart";
import { runStart } from "./lifecycle/start";
import { runStatus } from "./lifecycle/status";
import { runStop } from "./lifecycle/stop";
import { commandWordOf } from "./options";
import { serveInForeground } from "./serve";
import { runServiceCommand } from "./service/service-command";
import { cliVersion } from "./version";

/** `argv` is what follows the command word; for bare `tau` it is everything. */
export type CommandHandler = (argv: readonly string[]) => Promise<void>;

const apiCommandHandlers = Object.fromEntries(
  COMMAND_NOUNS.map((noun): [string, CommandHandler] => [noun, (argv) => runApiCommand(noun, argv)]),
);

/** The one dispatch table: command word to handler. */
export const commandTable: Readonly<Record<string, CommandHandler>> = {
  serve: serveInForeground,
  start: runStart,
  stop: runStop,
  restart: runRestart,
  status: runStatus,
  open: runOpen,
  logs: runLogs,
  service: runServiceCommand,
  skill: runSkill,
  help: runHelp,
  ...apiCommandHandlers,
  pair: runPair,
  connect: runConnect,
  disconnect: runDisconnect,
};

export const bareHandler: CommandHandler = (argv) => runBare(argv, serveInForeground);

const wantsHelp = (argv: readonly string[]) => argv.includes("--help") || argv.includes("-h");

export class UnknownCommandError extends Error {
  constructor(word: string) {
    super(`Unknown command: ${word}. Run \`tau --help\`.`);
    this.name = "UnknownCommandError";
  }
}

/** Picks the handler and the argv it receives. */
export function resolveCommand(
  argv: readonly string[],
  table: Readonly<Record<string, CommandHandler>> = commandTable,
  bare: CommandHandler = bareHandler,
): { readonly handler: CommandHandler; readonly argv: readonly string[] } {
  const { word, rest } = commandWordOf(argv);
  if (word === undefined)
    return wantsHelp(argv) ? { handler: table.help ?? bare, argv } : { handler: bare, argv };
  const handler = table[word];
  if (!handler) throw new UnknownCommandError(word);
  return { handler, argv: rest };
}

const wantsVersion = (argv: readonly string[]) =>
  argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v");

export async function main(argv: readonly string[]): Promise<void> {
  if (wantsVersion(argv)) {
    console.log(cliVersion());
    return;
  }
  const { handler, argv: rest } = resolveCommand(argv);
  await handler(rest);
}
