import { COMMAND_NOUNS, commandOf, commands, FLOW_COMMANDS } from "@tau/protocol";
import { usageError } from "./cli-exit";
import { commandFlags } from "./command-flags";
import { usageOf } from "./parse";

const THREAD_EXTRAS = [
  "  wait <id>       Wait until the thread is done, then print the answer (--timeout <s>)",
  "  read <id>       Print the thread as text (--last <n>)",
];

const LIFECYCLE = [
  "  start, stop, restart, status, open, logs, service   Run and manage the server",
  "  serve           Run the server in the foreground",
  "  update          Install the latest tau and restart the server (--check, --yes, --force, --no-restart)",
  "  skill           Print the tau skill for agents",
];

const UPDATE_FLAGS = [
  "",
  "tau update flags:",
  "  --check         Print current -> latest; exit 0 current, 10 update available, 1 error",
  '  --yes           Skip only the "Install X -> Y and restart?" question',
  "  --force         Restart even when threads are running",
  "  --no-restart    Install and verify, then print `tau restart`",
  "  --home <dir>, --port <n>   Forwarded to `tau restart`",
];

const CONNECT_LINES = [
  "",
  "Linking nodes:",
  "  connect <link>                      Link this node to another (both see each other)",
  "  connect <code> --node <url>         The same with the short code and the node's URL",
  "  disconnect [node]                   Unlink from a node (both sides forget each other)",
];

const pad = (text: string) => text.padEnd(26);

function rootHelp(): string {
  return [
    "tau: chat with a coding agent from the browser, and control it from the shell.",
    "",
    "Usage: tau <command> [args]   (no command starts the server and opens the browser)",
    "",
    "Server:",
    ...LIFECYCLE,
    "",
    "API commands (output is JSON):",
    ...COMMAND_NOUNS.map((noun) => `  ${noun}`),
    ...FLOW_COMMANDS.map((word) => `  ${word}`),
    "",
    ...CONNECT_LINES,
    "",
    "Run `tau <noun> --help` for the commands of a noun, `tau <noun> <verb> --help` for one command.",
    ...UPDATE_FLAGS,
  ].join("\n");
}

function nounHelp(noun: string): string {
  const lines = commands
    .filter((entry) => entry.command.startsWith(`${noun} `))
    .map((entry) => `  ${pad(`${entry.command.slice(noun.length + 1)} ${usageOf(entry)}`)}${entry.summary}`);
  const extras = noun === "threads" ? THREAD_EXTRAS : [];
  return [`tau ${noun} <command>`, "", ...lines, ...extras].join("\n");
}

function commandHelp(command: string): string {
  const def = commandOf(command);
  if (!def) throw usageError(`Unknown command: ${command}`);
  const flags = commandFlags(def).map((flag) => {
    const value = flag.kind === "value" ? " <value>" : "";
    return `  ${pad(`--${flag.name}${value}`)}${flag.summary}`;
  });
  const destructive = def.destructive ? ["", "Destructive: needs --yes."] : [];
  return [`tau ${def.command} ${usageOf(def)}`, def.summary, "", "Flags:", ...flags, ...destructive].join(
    "\n",
  );
}

/** Nouns, the commands of a noun, or one command's positionals and flags. */
export function helpText(noun?: string, verb?: string): string {
  if (noun === undefined) return rootHelp();
  if (!(COMMAND_NOUNS as readonly string[]).includes(noun)) throw usageError(`Unknown command: ${noun}`);
  if (verb === undefined) return nounHelp(noun);
  if (noun === "threads" && (verb === "wait" || verb === "read")) return nounHelp(noun);
  return commandHelp(`${noun} ${verb}`);
}

/** `tau help [noun [verb]]` and `tau --help`. */
export async function runHelp(argv: readonly string[]): Promise<void> {
  const words = argv.filter((word) => !word.startsWith("-"));
  console.log(helpText(words[0], words[1]));
}
