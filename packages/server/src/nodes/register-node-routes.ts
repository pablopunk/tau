import { AppError, type Core, routes } from "@tau/protocol";
import type { FastifyInstance } from "fastify";
import { defineRoute } from "../rest/define-route";
import type { DeviceSockets } from "../security/device-sockets";
import type { NodeGateway } from "./gateway";
import type { Relay } from "./relay";

export interface NodeRouteDeps {
  readonly core: Core;
  readonly sockets: DeviceSockets;
  readonly gateway: NodeGateway;
  readonly relay: Relay;
}

/** This tau's own node routes (denylisted from the proxy, so they always answer about THIS tau). */
export function registerNodeRoutes(
  app: FastifyInstance,
  { core, sockets, gateway, relay }: NodeRouteDeps,
): void {
  defineRoute(app, routes.listNodes, () => core.nodes.list());
  defineRoute(app, routes.renameNode, ({ params, body }) => core.nodes.rename(params.id, body.name));
  defineRoute(app, routes.getNodeSummary, async ({ params }) => {
    const summary = await core.nodes.readSummary(params.id);
    if (!summary) throw new AppError("not_found", "No summary for this node yet.");
    return summary;
  });
  defineRoute(app, routes.disconnectNode, async ({ params }) => {
    gateway.closeNode(params.id, "disconnect");
    await core.nodes.disconnect(params.id);
    sockets.closeDevice(params.id);
    sockets.closeNode(params.id);
  });
  defineRoute(app, routes.getNodeSelf, () => core.nodes.self());
  defineRoute(app, routes.forgetNode, async ({ params }) => {
    gateway.closeNode(params.id, "forget");
    await core.nodes.forget(params.id);
    sockets.closeDevice(params.id);
    sockets.closeNode(params.id);
  });
  defineRoute(app, routes.getNodeDirectory, () => core.nodes.directory());
  defineRoute(app, routes.listExpulsions, () => core.nodes.expulsions());
  // Created on THIS node only; `nodes` stays on the proxy denylist so it is never forwarded through /n/<id>.
  defineRoute(app, routes.removeNode, async ({ params, body }) => {
    const expel = await core.nodes.group.createExpel(params.id, body.confirm);
    await relay.floodExpel(expel);
  });
  defineRoute(app, routes.resetNodeIdentity, () => core.nodes.resetIdentity());
}
