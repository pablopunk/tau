import { nodeApiPrefix } from "@tau/protocol";
import { usageError } from "./cli-exit";
import type { Server } from "./client";

export const targetPath = (server: Server, path: string): string =>
  `${server.nodeId === undefined ? "" : nodeApiPrefix(server.nodeId)}${path}`;

/** Context flags are removed once, before generic and dedicated parsing. */
export function takeContextFlags(argv: readonly string[]): {
  machine: boolean;
  nodeId: string | undefined;
  rest: string[];
} {
  let machine = false;
  let nodeId: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--") {
      rest.push(...argv.slice(i));
      break;
    }
    if (arg === "--machine") {
      machine = true;
      continue;
    }
    if (arg === "--node" || arg.startsWith("--node=")) {
      if (nodeId !== undefined) throw usageError("Give --node only once");
      const value = arg === "--node" ? argv[++i] : arg.slice(7);
      if (!value || value.startsWith("--")) throw usageError("--node needs a stable node ID");
      nodeId = value;
      continue;
    }
    rest.push(arg);
  }
  return { machine, nodeId, rest };
}
