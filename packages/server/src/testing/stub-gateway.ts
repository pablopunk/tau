import { AppError } from "@tau/protocol";
import type { NodeGateway } from "../nodes/gateway";

const NOT_LINKED = "That node is not linked right now.";
const GOING_AWAY = 1001;

/** STUB for owner G: nothing is ever linked. Replace with the multiplexer. */
export function createStubGateway(): NodeGateway {
  return {
    acceptLink: (_nodeId, socket) => void socket.close(GOING_AWAY, "link not available"),
    isOnline: () => false,
    request: () => Promise.reject(new AppError("not_found", NOT_LINKED)),
    openStream: (_nodeId, _request, socket) => void socket.close(GOING_AWAY, "not linked"),
    closeNode: () => undefined,
  };
}
