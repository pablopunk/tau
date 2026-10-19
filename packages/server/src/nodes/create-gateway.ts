import { AppError, type Core } from "@tau/protocol";
import type { WebSocket } from "ws";
import type { NodeGateway } from "./gateway";
import { proxyRequest } from "./link-request";
import { LinkSession } from "./link-session";
import { pipeSocket } from "./link-socket";

const NOT_LINKED = "This node is offline.";
const TRY_AGAIN_LATER = 1013;
const REPLACED = 1000;
const REVOKED = 1008;

/** The real multiplexer: one `LinkSession` per node; a newer link replaces an older one. */
export function createNodeGateway(core: Core): NodeGateway {
  const sessions = new Map<string, LinkSession>();
  const online = (nodeId: string) => {
    const session = sessions.get(nodeId);
    return session?.registered ? session : undefined;
  };
  return {
    acceptLink(nodeId, socket: WebSocket) {
      sessions.get(nodeId)?.close(REPLACED, "replaced by a new link");
      const session: LinkSession = new LinkSession(nodeId, socket, core, {
        onEnded() {
          if (sessions.get(nodeId) !== session) return;
          sessions.delete(nodeId);
          core.nodes.markOffline(nodeId);
        },
      });
      sessions.set(nodeId, session);
    },
    isOnline: (nodeId) => online(nodeId) !== undefined,
    request(nodeId, request) {
      const session = online(nodeId);
      if (!session) return Promise.reject(new AppError("not_found", NOT_LINKED));
      return proxyRequest(session, request);
    },
    openStream(nodeId, request, socket) {
      const session = online(nodeId);
      if (!session) return void socket.close(TRY_AGAIN_LATER, "node offline");
      pipeSocket(session, request, socket);
    },
    closeNode(nodeId) {
      sessions.get(nodeId)?.close(REVOKED, "revoked");
    },
  };
}
