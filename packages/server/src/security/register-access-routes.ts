import { AppError, acceptLinkRefusal, type Core, PAIR_PAGE_PATH, routes } from "@tau/protocol";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { defineRoute } from "../rest/define-route";
import type { DeviceSockets } from "./device-sockets";
import { DEVICE_COOKIE } from "./guard";
import { PAIR_PAGE, PAIR_PAGE_HEADERS } from "./pair-page";
import type { TunnelTags } from "./tunnel-tags";

const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const LOCAL_PEER = "local";

export interface AccessRouteDeps {
  readonly core: Core;
  readonly tunnel: TunnelTags;
  readonly sockets: DeviceSockets;
}

function setDeviceCookie(reply: FastifyReply, secret: string, secure: boolean): void {
  reply.setCookie(DEVICE_COOKIE, secret, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

function registerRedeem({ core, tunnel }: AccessRouteDeps, app: FastifyInstance): void {
  app.post(
    routes.redeemPairing.path,
    { schema: { body: routes.redeemPairing.body } },
    async (request: FastifyRequest<{ Body: { code: string; deviceName: string } }>, reply) => {
      const tag = tunnel.tagOf(request.raw.socket);
      const redeemed = await core.access.redeemPairing({
        ...request.body,
        peer: tag?.peer ?? LOCAL_PEER,
        userAgent: request.headers["user-agent"],
      });
      if (redeemed.kind === "machine") return { deviceId: redeemed.deviceId, secret: redeemed.secret };
      setDeviceCookie(reply, redeemed.secret, tag !== undefined);
      return { deviceId: redeemed.deviceId };
    },
  );
}

function registerDevices({ core, sockets }: AccessRouteDeps, app: FastifyInstance): void {
  defineRoute(app, routes.listDevices, (_input, request) => core.access.listDevices(request.deviceId));
  defineRoute(app, routes.renameDevice, ({ params, body }) => core.access.renameDevice(params.id, body.name));
  defineRoute(app, routes.revokeDevice, async ({ params }) => {
    await core.access.revokeDevice(params.id);
    sockets.closeDevice(params.id);
  });
  defineRoute(app, routes.signOutAllDevices, async () => {
    const before = await core.access.listDevices();
    await core.access.signOutAll();
    for (const device of before) if (device.kind !== "machine") sockets.closeDevice(device.id);
  });
  defineRoute(app, routes.mintPairing, async ({ query }) => {
    const refusal = query.kind === "machine" ? acceptLinkRefusal(await core.machines.hubState()) : undefined;
    if (refusal) throw new AppError("invalid_request", refusal);
    return core.access.mintPairing(query);
  });
}

export function registerAccessRoutes(app: FastifyInstance, deps: AccessRouteDeps): void {
  const { core } = deps;
  defineRoute(app, routes.getHealth, async () => ({ ok: true as const }));
  app.get(PAIR_PAGE_PATH, async (_request, reply) =>
    reply.headers(PAIR_PAGE_HEADERS).type("text/html; charset=utf-8").send(PAIR_PAGE),
  );
  registerRedeem(deps, app);
  registerDevices(deps, app);
  defineRoute(app, routes.getRemoteStatus, () => core.remote.status());
  defineRoute(app, routes.enableRemote, () => core.remote.enable());
  defineRoute(app, routes.disableRemote, () => core.remote.disable());
  defineRoute(app, routes.recreateRemote, () => core.remote.recreate());
}
