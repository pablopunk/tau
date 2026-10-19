import { AppError, type Core, routes } from "@tau/protocol";
import type { FastifyInstance } from "fastify";
import { defineRoute } from "../rest/define-route";
import type { DeviceSockets } from "../security/device-sockets";
import type { NodeGateway } from "./gateway";

export interface NodeRouteDeps {
  readonly core: Core;
  readonly sockets: DeviceSockets;
  readonly gateway: NodeGateway;
}

/** The hub's own node routes (denylisted from the proxy, so they always answer about THIS tau). */
export function registerNodeRoutes(app: FastifyInstance, { core, sockets, gateway }: NodeRouteDeps): void {
  defineRoute(app, routes.listNodes, () => core.nodes.list());
  defineRoute(app, routes.renameNode, ({ params, body }) => core.nodes.rename(params.id, body.name));
  defineRoute(app, routes.getNodeSummary, async ({ params }) => {
    const summary = await core.nodes.readSummary(params.id);
    if (!summary) throw new AppError("not_found", "No summary for this node yet.");
    return summary;
  });
  defineRoute(app, routes.disconnectNode, async ({ params }) => {
    await core.nodes.disconnect(params.id);
    sockets.closeDevice(params.id);
    sockets.closeNode(params.id);
    gateway.closeNode(params.id);
  });
  defineRoute(app, routes.getHubLink, () => core.nodes.hubState());
  defineRoute(app, routes.disconnectHub, () => core.nodes.disconnectHub());
}
