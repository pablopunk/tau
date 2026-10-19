import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NodeSelf } from "@tau/protocol";
import { nodeIdOf } from "@tau/protocol/identity";
import { callRoute, type Server } from "../commands/client";
import type { CommandEnv } from "../commands/command-env";

async function fromFile(home: string): Promise<string | undefined> {
  try {
    const stored = JSON.parse(await readFile(join(home, "node.json"), "utf8")) as { publicKey?: unknown };
    return typeof stored.publicKey === "string" ? nodeIdOf(stored.publicKey) : undefined;
  } catch {
    return undefined;
  }
}

/** This node's id: from the running server, else from `node.json` (never created here). `undefined` when unknown. */
export async function ownNodeId(env: CommandEnv, server: Server | undefined): Promise<string | undefined> {
  if (server) {
    try {
      return ((await callRoute(server, "getNodeSelf", {}, env)) as NodeSelf).nodeId;
    } catch {
      // fall back to the file
    }
  }
  return fromFile(env.home);
}
