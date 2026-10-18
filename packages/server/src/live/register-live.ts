import { type Core, LIVE_PATH } from "@tau/protocol";
import type { FastifyInstance } from "fastify";
import type { DeviceSockets } from "../security/device-sockets";
import { LiveConnection } from "./connection";

export function registerLive(app: FastifyInstance, core: Core, sockets: DeviceSockets): void {
  app.get(LIVE_PATH, { websocket: true }, (socket, request) => {
    if (!sockets.add(request.deviceId, socket)) return;
    new LiveConnection(socket, core, (error) => request.log.error(error));
  });
}
