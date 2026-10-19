import { LINK_CLOSE_UPDATE_REQUIRED, NODE_LINK_LEGACY_PATH } from "@tau/protocol";
import type { FastifyInstance } from "fastify";

/**
 * `GET /api/machines/link`, the 0.1.x link path. The guard already accepted the node secret (exactly this path,
 * with an Upgrade); a 0.1.x dialler cannot speak the new handshake, so it is told to update: close 4001, which
 * its client shows as "Update tau" and does not treat as a refusal.
 */
export function registerLegacyLink(app: FastifyInstance): void {
  app.get(NODE_LINK_LEGACY_PATH, { websocket: true }, (socket) => {
    socket.close(LINK_CLOSE_UPDATE_REQUIRED, "update required");
  });
}
