import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  alreadyLinkedRefusal,
  connectRefusal,
  type HubLink,
  type Node,
  RedeemPairingResponseSchema,
} from "@tau/protocol";
import { Value } from "typebox/value";
import { parseConnectArgs } from "../nodes/connect-args";
import { type AfterLink, type ConnectIo, terminalIo } from "../nodes/connect-io";
import { parseConnectTarget } from "../nodes/connect-target";
import { createHubFileStore } from "../nodes/hub-file";
import { CliExit, failure, usageError } from "./cli-exit";
import { callRoute, discoverServer, type Server } from "./client";
import { type CommandEnv, processEnv } from "./command-env";
import { takeHomeFlag } from "./run-command";

const REDEEM_PATH = "/api/pair/redeem";

async function runningServer(env: CommandEnv): Promise<Server | undefined> {
  try {
    return await discoverServer(env);
  } catch {
    return undefined;
  }
}

async function linkedNodeCount(server: Server | undefined, env: CommandEnv): Promise<number> {
  if (server) return ((await callRoute(server, "listNodes", {}, env)) as Node[]).length;
  try {
    // The summaries directory keeps its on-disk name `machines` until MVP13 Step 1.
    return (await readdir(join(env.home, "machines"))).length;
  } catch {
    return 0;
  }
}

async function redeem(hubUrl: string, code: string, deviceName: string, env: CommandEnv): Promise<string> {
  let response: Response;
  try {
    response = await env.fetch(`${hubUrl}${REDEEM_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: hubUrl },
      body: JSON.stringify({ code, deviceName }),
    });
  } catch {
    throw failure(`Could not reach the hub at ${hubUrl}. Is it running and online?`);
  }
  if (!response.ok) {
    throw failure(
      response.status === 429
        ? "Too many tries. Wait a few minutes and make a new code on the hub."
        : "The hub did not accept that code. It may have expired: make a new one in Settings → Nodes.",
    );
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!Value.Check(RedeemPairingResponseSchema, body) || body.secret === undefined) {
    throw failure("The hub answered without a node secret. Make a new link code (kind: node).");
  }
  return body.secret;
}

async function startAfterLink(choice: AfterLink, env: CommandEnv): Promise<void> {
  if (choice === "serve") {
    const { serveInForeground } = await import("../serve");
    env.stdout("Starting tau for this session. Press Ctrl+C to stop.");
    await serveInForeground(["--no-open", "--home", env.home]);
  } else if (choice === "service") {
    const { runServiceCommand } = await import("../service/service-command");
    await runServiceCommand(["install", "--home", env.home]);
  } else {
    env.stdout("Run `tau` (or `tau service install`) to bring this node online.");
  }
}

/**
 * `tau connect <link | code --hub <url>> [--name <label>] [--yes]`: redeem a link code on a hub and keep its
 * node secret in `hub.json`. A running server picks the file up on its own.
 */
export async function executeConnect(
  argv: readonly string[],
  env: CommandEnv,
  io: ConnectIo = terminalIo,
): Promise<void> {
  const args = parseConnectArgs(argv);
  const target = parseConnectTarget(args.target, args.hub);
  const hubFile = createHubFileStore(env.home);
  const refusal = alreadyLinkedRefusal((await hubFile.read()) !== undefined);
  if (refusal) throw usageError(refusal);
  const server = await runningServer(env);
  const loop = connectRefusal(await linkedNodeCount(server, env));
  if (loop) throw usageError(loop);

  const hubName = target.hubName ?? new URL(target.hubUrl).host;
  if (!args.yes && !(await io.confirm(`Link this node to ${hubName} (${target.hubUrl})?`))) {
    throw new CliExit(1, "Not linked.");
  }
  const nodeSecret = await redeem(target.hubUrl, target.code, args.name, env);
  await hubFile.write({ hubUrl: target.hubUrl, nodeSecret, name: hubName, nodeName: args.name });
  env.stdout(`Linked to ${hubName} as "${args.name}".`);
  if (server) return env.stdout("The running tau connects within a few seconds.");
  await startAfterLink(args.yes ? "none" : await io.chooseStart(), env);
}

/** `tau disconnect`: tells the running server (it closes the link and forgets the hub), then removes `hub.json`. */
export async function executeDisconnect(argv: readonly string[], env: CommandEnv): Promise<void> {
  if (argv.length > 0) throw usageError("Usage: tau disconnect");
  const hubFile = createHubFileStore(env.home);
  const file = await hubFile.read();
  const server = await runningServer(env);
  if (!file && !server) return env.stdout("This tau is not linked to a hub.");
  if (server) {
    const link = (await callRoute(server, "getHubLink", {}, env)) as HubLink;
    if (link.state !== "none") await callRoute(server, "disconnectHub", {}, env);
  }
  await hubFile.delete();
  if (!file) return env.stdout("This tau is not linked to a hub.");
  env.stdout(
    `Disconnected from ${file.name}. Remove this node in the hub's Settings → Nodes to revoke it there.`,
  );
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
