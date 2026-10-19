import { NODE_LINK_PATH } from "@tau/protocol";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { DeviceSockets } from "../security/device-sockets";
import { OWNER_DEVICE_ID } from "../security/guard";
import { secretKeyOf } from "./link-peer";
import type { AttachPeer, PeerHandle } from "./peer-seam";

const POLICY_VIOLATION = 1008;
const BEARER = /^Bearer\s+(\S+)$/i;

export interface LinkRouteDeps {
  readonly sockets: DeviceSockets;
  /** Read at connection time: the seam exists once the server is listening. */
  readonly attachPeer: () => AttachPeer;
}

/** `sha256` of the node secret the guard accepted (so equal values are one device); never the secret itself. */
function secretKeyOfRequest(authorization: string | undefined): string {
  const secret = BEARER.exec(authorization ?? "")?.[1] ?? "";
  return secretKeyOf(secret);
}

/** A revoke closes the device's sockets; for a link that must say `bye` first, so it goes through the handle. */
function closableAsLink(socket: WebSocket, handle: PeerHandle): WebSocket {
  return {
    close: (code?: number, reason?: string) => handle.close(code, reason, true),
    once: (event: string, listener: (...args: unknown[]) => void) => socket.once(event as "close", listener),
  } as unknown as WebSocket;
}

/**
 * `GET /api/nodes/link`: an ordinary guarded WebSocket route on the shared server. The guard accepted a node
 * secret and set `request.deviceId` to the node's device id; the owner (master token) may reach this handler too
 * and is refused here. The socket runs the symmetric link as the acceptor; a revoke closes it with `bye`.
 */
export function registerNodeLink(app: FastifyInstance, { sockets, attachPeer }: LinkRouteDeps): void {
  app.get(NODE_LINK_PATH, { websocket: true }, (socket, request) => {
    if (request.deviceId === OWNER_DEVICE_ID) return void socket.close(POLICY_VIOLATION, "nodes only");
    const handle = attachPeer()(socket, "acceptor", {
      peerId: request.deviceId,
      secretKey: secretKeyOfRequest(request.headers.authorization),
    });
    sockets.add(request.deviceId, closableAsLink(socket, handle));
  });
}
