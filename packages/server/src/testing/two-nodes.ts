import { NODE_LINK_PATH, type Node } from "@tau/protocol";
import { expect, vi } from "vitest";
import WebSocket from "ws";
import { secretKeyOf } from "../nodes/link-peer";
import type { PeerHandle } from "../nodes/peer-seam";
import { startTestServer, type TestServer } from "./harness";
import { createIdentityCore, type IdentityCore } from "./identity-core";

export interface TestNode extends IdentityCore {
  readonly name: string;
  readonly ctx: TestServer;
  stop(): Promise<void>;
}

/** A real `createServer` on a free loopback port with its own fake core and its own Ed25519 identity. */
export async function startNode(name: string, keys?: IdentityCore["keys"]): Promise<TestNode> {
  const identity = createIdentityCore(name, {}, keys);
  const ctx = await startTestServer({ core: identity.core });
  return {
    ...identity,
    name,
    ctx,
    stop: async () => {
      await ctx.server.close();
      await identity.core.close();
    },
  };
}

export interface Dialled {
  readonly handle: PeerHandle;
  readonly socket: WebSocket;
  readonly secret: string;
  /** The device id the acceptor knows this dialler by. */
  readonly deviceId: string;
}

export interface DialOptions {
  /** Reuse a secret (a reconnect); otherwise a new node device is paired on the acceptor. */
  readonly secret?: string;
  readonly deviceId?: string;
  readonly pinnedNodeId?: string | null;
  readonly peerId?: string;
}

/** `from` dials `to`: the way `tau connect` and the CLI's link client do, over a real socket. */
export async function dial(from: TestNode, to: TestNode, options: DialOptions = {}): Promise<Dialled> {
  const paired = options.secret ? undefined : await pair(from, to);
  const secret = options.secret ?? (paired?.secret as string);
  const deviceId = options.deviceId ?? paired?.deviceId ?? "";
  const socket = new WebSocket(`ws://127.0.0.1:${to.ctx.server.port}${NODE_LINK_PATH}`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  const handle = from.ctx.server.attachPeer(socket, "dialler", {
    peerId: options.peerId ?? `u-${to.name}`,
    pinnedNodeId: options.pinnedNodeId === null ? undefined : (options.pinnedNodeId ?? to.nodeId),
    secretKey: secretKeyOf(secret),
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) =>
      reject(new Error(`refused ${response.statusCode}`)),
    );
  });
  return { handle, socket, secret, deviceId };
}

async function pair(from: TestNode, to: TestNode): Promise<{ secret: string; deviceId: string }> {
  const minted = await to.core.access.mintPairing({ kind: "node" });
  return to.core.access.redeemPairing({ code: minted.code, deviceName: from.name, peer: "127.0.0.1" });
}

const nodeOf = async (host: TestNode, nodeId: string): Promise<Node | undefined> =>
  (await host.core.nodes.list()).find((node) => node.id === nodeId);

/** Waits until `host` lists `peer` as online. */
export async function waitOnline(host: TestNode, peer: TestNode): Promise<void> {
  await vi.waitFor(async () => expect((await nodeOf(host, peer.nodeId))?.status).toBe("online"), {
    timeout: 5000,
  });
}

export async function waitOffline(host: TestNode, peer: TestNode): Promise<void> {
  await vi.waitFor(async () => expect((await nodeOf(host, peer.nodeId))?.status).toBe("offline"), {
    timeout: 5000,
  });
}

/** `a` dials `b`; both sides see each other online. */
export async function linkNodes(a: TestNode, b: TestNode): Promise<Dialled> {
  const link = await dial(a, b);
  await Promise.all([waitOnline(a, b), waitOnline(b, a)]);
  return link;
}

/** `/api/n/<nodeId>` + path, as a browser on `host` would call it. */
export const viaNode = (peer: TestNode, path: string) => `/api/n/${peer.nodeId}${path}`;
