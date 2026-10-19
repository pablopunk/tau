import { hostname } from "node:os";
import { usageError } from "../commands/cli-exit";

export interface ConnectArgs {
  readonly target: string;
  readonly node?: string;
  readonly name: string;
  readonly yes: boolean;
}

const USAGE = "Usage: tau connect <link | code --node <url>> [--name <label>] [--yes]";

export const CONNECT_HELP = [
  USAGE,
  "",
  "  <link>           https://<host>/pair#<code>, from Settings → Nodes → Connect a node on the other node",
  "  <code> --node    The 8-character code and the other node's URL (http:// only for 127.0.0.1)",
  "  --name <label>   How the other node shows this one (default: this computer's name)",
  "  --yes            Skip the question",
  "",
  "Both nodes see each other and get full power over each other. Undo it with `tau disconnect [node]`.",
].join("\n");

export const wantsConnectHelp = (argv: readonly string[]): boolean =>
  argv.includes("--help") || argv.includes("-h");

export function parseConnectArgs(argv: readonly string[]): ConnectArgs {
  let target: string | undefined;
  let node: string | undefined;
  let name: string | undefined;
  let yes = false;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] as string;
    const next = argv[index + 1];
    if ((token === "--node" || token === "--hub") && next !== undefined) node = argv[++index];
    else if (token.startsWith("--node=")) node = token.slice("--node=".length);
    else if (token.startsWith("--hub="))
      node = token.slice("--hub=".length); // hidden alias, one release
    else if (token === "--name" && next !== undefined) name = argv[++index];
    else if (token.startsWith("--name=")) name = token.slice("--name=".length);
    else if (token === "--yes" || token === "-y") yes = true;
    else if (!token.startsWith("-") && target === undefined) target = token;
    else throw usageError(`Unknown argument "${token}". ${USAGE}`);
  }
  if (target === undefined) throw usageError(USAGE);
  return { target, ...(node !== undefined && { node }), name: name?.trim() || hostname(), yes };
}
