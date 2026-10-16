import { type Core, LIVE_PATH } from "@pi-everywhere/protocol";
import type { FastifyInstance } from "fastify";
import { LiveConnection } from "./connection";

export function registerLive(app: FastifyInstance, core: Core): void {
  app.get(LIVE_PATH, { websocket: true }, (socket, request) => {
    new LiveConnection(socket, core, (error) => request.log.error(error));
  });
}
