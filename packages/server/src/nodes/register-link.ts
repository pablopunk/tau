import { acceptLinkRefusal, type Core, NODE_LINK_PATH } from "@tau/protocol";
import type { FastifyInstance } from "fastify";
import type { DeviceSockets } from "../security/device-sockets";
import { OWNER_DEVICE_ID } from "../security/guard";
import type { NodeGateway } from "./gateway";

const POLICY_VIOLATION = 1008;

export interface LinkRouteDeps {
  readonly core: Core;
  readonly sockets: DeviceSockets;
  readonly gateway: NodeGateway;
}

/**
 * `GET /api/nodes/link`: an ordinary guarded WebSocket route on the shared server (no second WebSocketServer).
 * The guard already accepted a node secret and set `request.deviceId` to the node's device id; the owner
 * (master token) may reach this handler too and is refused here. Registered in `sockets` so a revoke closes the link.
 * Owner G: replace the stub gateway; the guard, caps and registration stay.
 */
export function registerNodeLink(app: FastifyInstance, { core, sockets, gateway }: LinkRouteDeps): void {
  app.get(NODE_LINK_PATH, { websocket: true }, async (socket, request) => {
    if (request.deviceId === OWNER_DEVICE_ID) return void socket.close(POLICY_VIOLATION, "nodes only");
    if (acceptLinkRefusal(await core.nodes.hubState()))
      return void socket.close(POLICY_VIOLATION, "hub is linked");
    if (!sockets.add(request.deviceId, socket)) return;
    gateway.acceptLink(request.deviceId, socket);
  });
}
