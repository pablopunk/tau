import { type Core, TERMINAL_STREAM_PATH } from "@tau/protocol";
import type { FastifyInstance } from "fastify";
import type { DeviceSockets } from "../security/device-sockets";
import { TerminalStream } from "./stream-connection";

export function registerTerminalStream(app: FastifyInstance, core: Core, sockets: DeviceSockets): void {
  app.get<{ Params: { id: string } }>(TERMINAL_STREAM_PATH, { websocket: true }, (socket, request) => {
    sockets.add(request.deviceId, socket);
    new TerminalStream(socket, core, request.params.id, (error) => request.log.error(error));
  });
}
