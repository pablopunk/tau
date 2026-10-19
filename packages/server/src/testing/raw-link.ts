import { NODE_LINK_PATH } from "@tau/protocol";
import { generateNodeKeys } from "@tau/protocol/identity";
import { expect, vi } from "vitest";
import WebSocket from "ws";
import { secretKeyOf } from "../nodes/link-peer";
import type { PeerHandle } from "../nodes/peer-seam";
import { dialRawPeer, listenRawPeer, type RawPeer, type RawPeerOptions, type RawServer } from "./raw-peer";
import type { TestNode } from "./two-nodes";

export interface RawLink {
  readonly peer: RawPeer;
  /** The real node's side of the link, when it was the dialler. */
  readonly handle?: PeerHandle;
  /** `Bearer` secret and device id when the real node was the acceptor. */
  readonly secret?: string;
  readonly deviceId?: string;
  stop(): Promise<void>;
}

/** Who plays what: the real node is the `acceptor` (the raw peer dials it) or the `dialler` (it dials the raw peer). */
export type RealRole = "acceptor" | "dialler";

export const ROLES: readonly RealRole[] = ["acceptor", "dialler"];

type RawLinkOptions = Omit<RawPeerOptions, "role" | "keys"> & {
  readonly keys?: RawPeerOptions["keys"];
  readonly manual?: boolean;
};

/** Links `node` to a raw protocol peer and waits until both ended the handshake and `node` lists it online. */
export async function linkRaw(
  node: TestNode,
  real: RealRole,
  options: RawLinkOptions = {},
): Promise<RawLink> {
  const keys = options.keys ?? generateNodeKeys();
  const link =
    real === "acceptor" ? await rawDialsNode(node, keys, options) : await nodeDialsRaw(node, keys, options);
  if (!options.manual) {
    await link.peer.established;
    await vi.waitFor(async () =>
      expect((await node.core.nodes.list()).find((entry) => entry.id === link.peer.nodeId)?.status).toBe(
        "online",
      ),
    );
  }
  return link;
}

async function rawDialsNode(
  node: TestNode,
  keys: RawPeerOptions["keys"],
  options: RawLinkOptions,
): Promise<RawLink> {
  const minted = await node.core.access.mintPairing({ kind: "node" });
  const redeemed = await node.core.access.redeemPairing({
    code: minted.code,
    deviceName: "Raw",
    peer: "127.0.0.1",
  });
  const peer = await dialRawPeer(`ws://127.0.0.1:${node.ctx.server.port}${NODE_LINK_PATH}`, redeemed.secret, {
    ...options,
    keys,
  });
  return { peer, secret: redeemed.secret, deviceId: redeemed.deviceId, stop: async () => peer.stop() };
}

async function nodeDialsRaw(
  node: TestNode,
  keys: RawPeerOptions["keys"],
  options: RawLinkOptions,
): Promise<RawLink> {
  const server: RawServer = await listenRawPeer({ ...options, keys });
  const socket = new WebSocket(server.url);
  socket.once("error", () => undefined);
  const pending = server.nextPeer();
  const { nodeIdOf } = await import("@tau/protocol/identity");
  const handle = node.ctx.server.attachPeer(socket, "dialler", {
    peerId: "u-raw",
    pinnedNodeId: nodeIdOf(keys.publicKey),
    secretKey: secretKeyOf("raw-secret"),
  });
  const peer = await pending;
  return {
    peer,
    handle,
    stop: async () => {
      peer.stop();
      await server.close();
    },
  };
}
