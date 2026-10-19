import type { Core } from "@tau/protocol";
import type { DeviceSockets } from "../security/device-sockets";
import type { AttachPeer } from "./peer-seam";

const TRY_AGAIN_LATER = 1013;

export interface AttachPeerDeps {
  readonly core: Core;
  readonly sockets: DeviceSockets;
}

/**
 * STUB (Step 1 foundation) for owner B: `createLinkPeer({ socket, role, server, peer })` goes here. Until then a
 * socket handed to the seam is closed with 1013 and nothing is linked through it; the 0.1.x one-way gateway keeps
 * running beside it so the tree stays green.
 */
export function createAttachPeer(_deps: AttachPeerDeps): AttachPeer {
  return (socket) => {
    socket.close(TRY_AGAIN_LATER, "peer links are not implemented yet");
    return {
      closed: new Promise((resolve) =>
        socket.once("close", (code, reason) =>
          resolve({ code, reason: reason.toString(), linked: false, bye: false }),
        ),
      ),
      close: () => undefined,
    };
  };
}
