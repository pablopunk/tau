import { AppError, type Core, routes } from "@tau/protocol";
import type { FastifyInstance } from "fastify";
import { defineRoute } from "../rest/define-route";
import type { DeviceSockets } from "../security/device-sockets";
import type { MachineGateway } from "./gateway";

export interface MachineRouteDeps {
  readonly core: Core;
  readonly sockets: DeviceSockets;
  readonly gateway: MachineGateway;
}

/** The hub's own machine routes (denylisted from the proxy, so they always answer about THIS tau). */
export function registerMachineRoutes(
  app: FastifyInstance,
  { core, sockets, gateway }: MachineRouteDeps,
): void {
  defineRoute(app, routes.listMachines, () => core.machines.list());
  defineRoute(app, routes.renameMachine, ({ params, body }) => core.machines.rename(params.id, body.name));
  defineRoute(app, routes.getMachineSummary, async ({ params }) => {
    const summary = await core.machines.readSummary(params.id);
    if (!summary) throw new AppError("not_found", "No summary for this machine yet.");
    return summary;
  });
  defineRoute(app, routes.disconnectMachine, async ({ params }) => {
    await core.machines.disconnect(params.id);
    sockets.closeDevice(params.id);
    sockets.closeMachine(params.id);
    gateway.closeMachine(params.id);
  });
  defineRoute(app, routes.getHubLink, () => core.machines.hubState());
  defineRoute(app, routes.disconnectHub, () => core.machines.disconnectHub());
}
