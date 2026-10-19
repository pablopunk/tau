import { AppError } from "@tau/protocol";
import type { MachineGateway } from "../machines/gateway";

const NOT_LINKED = "That machine is not linked right now.";
const GOING_AWAY = 1001;

/** STUB for owner G: nothing is ever linked. Replace with the multiplexer. */
export function createStubGateway(): MachineGateway {
  return {
    acceptLink: (_machineId, socket) => void socket.close(GOING_AWAY, "link not available"),
    isOnline: () => false,
    request: () => Promise.reject(new AppError("not_found", NOT_LINKED)),
    openStream: (_machineId, _request, socket) => void socket.close(GOING_AWAY, "not linked"),
    closeMachine: () => undefined,
  };
}
