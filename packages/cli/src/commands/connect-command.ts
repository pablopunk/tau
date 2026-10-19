import { readFile, rm } from "node:fs/promises";
import { createFilePeersStore, hubFilePath, type Peer, peerIdOf, peersFilePath } from "@tau/core";
import { alreadyLinkedRefusal, RedeemPairingResponseSchema, selfLinkRefusal } from "@tau/protocol";
import { Value } from "typebox/value";
import { CONNECT_HELP, parseConnectArgs, wantsConnectHelp } from "../nodes/connect-args";
import { type AfterLink, type ConnectIo, terminalIo } from "../nodes/connect-io";
import { parseConnectTarget } from "../nodes/connect-target";
import { ownNodeId } from "../nodes/own-node-id";
import { pickPeer } from "../nodes/peer-pick";
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

interface Redeemed {
  readonly secret: string;
  readonly nodeId?: string;
}

async function redeem(
  nodeUrl: string,
  code: string,
  deviceName: string,
  own: string | undefined,
  env: CommandEnv,
): Promise<Redeemed> {
  let response: Response;
  try {
    response = await env.fetch(`${nodeUrl}${REDEEM_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: nodeUrl },
      body: JSON.stringify({ code, deviceName, ...(own && { nodeId: own }) }),
    });
  } catch {
    throw failure(`Could not reach the node at ${nodeUrl}. Is it running and online?`);
  }
  if (!response.ok) {
    throw failure(
      response.status === 429
        ? "Too many tries. Wait a few minutes and make a new code on that node."
        : "The node did not accept that code. It may have expired: make a new one in Settings → Nodes.",
    );
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!Value.Check(RedeemPairingResponseSchema, body) || body.secret === undefined) {
    throw failure("The node answered without a node secret. Make a new link code (kind: node).");
  }
  return { secret: body.secret, ...(body.nodeId !== undefined && { nodeId: body.nodeId }) };
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

const sameNode = (peer: Peer, url: string, nodeId: string | undefined): boolean =>
  peer.url === url || (nodeId !== undefined && peer.nodeId === nodeId);

/**
 * `tau connect <link | code --node <url>> [--name <label>] [--yes]`: redeem a link code on another node and keep its
 * node secret, with its pinned `nodeId`, in `peers.json`. A running server picks the entry up on its own.
 */
export async function executeConnect(
  argv: readonly string[],
  env: CommandEnv,
  io: ConnectIo = terminalIo,
): Promise<void> {
  if (wantsConnectHelp(argv)) return env.stdout(CONNECT_HELP);
  const args = parseConnectArgs(argv);
  const target = parseConnectTarget(args.target, args.node);
  const peers = createFilePeersStore(peersFilePath(env.home));
  const known = (await peers.read()).some((peer) => sameNode(peer, target.nodeUrl, target.nodeId));
  const refusal = alreadyLinkedRefusal(known);
  if (refusal) throw usageError(refusal);
  const server = await runningServer(env);
  const own = await ownNodeId(env, server);
  const self = selfLinkRefusal(own ?? "", target.nodeId);
  if (self) throw usageError(self);

  const peerName = target.peerLabel ?? new URL(target.nodeUrl).host;
  if (!args.yes && !(await io.confirm(`Link this node to ${peerName} (${target.nodeUrl})?`))) {
    throw new CliExit(1, "Not linked.");
  }
  const redeemed = await redeem(target.nodeUrl, target.code, args.name, own, env);
  if (target.nodeId !== undefined && redeemed.nodeId !== undefined && redeemed.nodeId !== target.nodeId) {
    throw failure("The node that answered is not the one in the link. Nothing was linked.");
  }
  const nodeId = redeemed.nodeId ?? target.nodeId;
  const answeredSelf = selfLinkRefusal(own ?? "", nodeId);
  if (answeredSelf) throw usageError(answeredSelf);
  const entry: Peer = {
    url: target.nodeUrl,
    name: peerName,
    secret: redeemed.secret,
    nodeName: args.name,
    ...(nodeId !== undefined && { nodeId }),
  };
  await peers.write([...(await peers.read()), entry]);
  env.stdout(`Linked to ${peerName} as "${args.name}".`);
  if (server) return env.stdout("The running tau connects within a few seconds.");
  await startAfterLink(args.yes ? "none" : await io.chooseStart(), env);
}

function nodeUrlOf(text: string): unknown {
  try {
    return (JSON.parse(text) as { nodeUrl?: unknown } | null)?.nodeUrl;
  } catch {
    return undefined;
  }
}

/** The 0.1.x `hub.json` stays after migration (downgrade); it goes with the peer it describes. */
async function removeLegacyHubFile(home: string, peer: Peer | undefined): Promise<void> {
  const file = hubFilePath(home);
  const text = await readFile(file, "utf8").catch(() => undefined);
  if (text === undefined) return;
  const nodeUrl = nodeUrlOf(text);
  if (peer === undefined || nodeUrl === peer.url || typeof nodeUrl !== "string")
    await rm(file, { force: true });
}

async function tellServer(env: CommandEnv, id: string): Promise<void> {
  const server = await runningServer(env);
  if (!server) return;
  await callRoute(server, "disconnectNode", { params: { id } }, env).catch(() => undefined);
}

/**
 * `tau disconnect [node]`: tells the running server (it closes the link and revokes the peer), then removes the
 * `peers.json` entry and any left-over 0.1.x `hub.json` (so a downgrade does not bring the link back).
 */
export async function executeDisconnect(argv: readonly string[], env: CommandEnv): Promise<void> {
  if (argv.length > 1) throw usageError("Usage: tau disconnect [node]");
  const store = createFilePeersStore(peersFilePath(env.home));
  const peers = await store.read();
  const peer = pickPeer(peers, argv[0]);
  if (peer) {
    await tellServer(env, peerIdOf(peer));
    const rest = (await store.read()).filter((entry) => peerIdOf(entry) !== peerIdOf(peer));
    await store.write(rest);
  }
  await removeLegacyHubFile(env.home, peer);
  if (!peer) return env.stdout("This node is not linked to another node.");
  env.stdout(
    `Disconnected from ${peer.name}. Remove this node in that node's Settings → Nodes to revoke it there.`,
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
