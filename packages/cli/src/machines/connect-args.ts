import { hostname } from "node:os";
import { usageError } from "../commands/cli-exit";

export interface ConnectArgs {
  readonly target: string;
  readonly hub?: string;
  readonly name: string;
  readonly yes: boolean;
}

const USAGE = "Usage: tau connect <link | code --hub <url>> [--name <label>] [--yes]";

export function parseConnectArgs(argv: readonly string[]): ConnectArgs {
  let target: string | undefined;
  let hub: string | undefined;
  let name: string | undefined;
  let yes = false;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] as string;
    const next = argv[index + 1];
    if (token === "--hub" && next !== undefined) hub = argv[++index];
    else if (token.startsWith("--hub=")) hub = token.slice("--hub=".length);
    else if (token === "--name" && next !== undefined) name = argv[++index];
    else if (token.startsWith("--name=")) name = token.slice("--name=".length);
    else if (token === "--yes" || token === "-y") yes = true;
    else if (!token.startsWith("-") && target === undefined) target = token;
    else throw usageError(`Unknown argument "${token}". ${USAGE}`);
  }
  if (target === undefined) throw usageError(USAGE);
  return { target, ...(hub !== undefined && { hub }), name: name?.trim() || hostname(), yes };
}
