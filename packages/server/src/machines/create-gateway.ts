import { AppError, type Core } from "@tau/protocol";
import type { WebSocket } from "ws";
import type { MachineGateway } from "./gateway";
import { proxyRequest } from "./link-request";
import { LinkSession } from "./link-session";
import { pipeSocket } from "./link-socket";

const NOT_LINKED = "This machine is offline.";
const TRY_AGAIN_LATER = 1013;
const REPLACED = 1000;
const REVOKED = 1008;

/** The real multiplexer: one `LinkSession` per machine; a newer link replaces an older one. */
export function createMachineGateway(core: Core): MachineGateway {
  const sessions = new Map<string, LinkSession>();
  const online = (machineId: string) => {
    const session = sessions.get(machineId);
    return session?.registered ? session : undefined;
  };
  return {
    acceptLink(machineId, socket: WebSocket) {
      sessions.get(machineId)?.close(REPLACED, "replaced by a new link");
      const session: LinkSession = new LinkSession(machineId, socket, core, {
        onEnded() {
          if (sessions.get(machineId) !== session) return;
          sessions.delete(machineId);
          core.machines.markOffline(machineId);
        },
      });
      sessions.set(machineId, session);
    },
    isOnline: (machineId) => online(machineId) !== undefined,
    request(machineId, request) {
      const session = online(machineId);
      if (!session) return Promise.reject(new AppError("not_found", NOT_LINKED));
      return proxyRequest(session, request);
    },
    openStream(machineId, request, socket) {
      const session = online(machineId);
      if (!session) return void socket.close(TRY_AGAIN_LATER, "machine offline");
      pipeSocket(session, request, socket);
    },
    closeMachine(machineId) {
      sessions.get(machineId)?.close(REVOKED, "revoked");
    },
  };
}
