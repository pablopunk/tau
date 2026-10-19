import { AppError } from "@tau/protocol";
import type { NodeGateway } from "../nodes/gateway";

const NOT_LINKED = "That node is not linked right now.";
const TRY_AGAIN_LATER = 1013;

/** A gateway where nothing is ever linked: the base for tests that stub `request` and `openStream`. */
export function createStubGateway(): NodeGateway {
  return {
    isOnline: () => false,
    request: () => Promise.reject(new AppError("not_found", NOT_LINKED)),
    openStream: (_nodeId, _request, socket) => void socket.close(TRY_AGAIN_LATER, "not linked"),
    closeNode: () => undefined,
  };
}
