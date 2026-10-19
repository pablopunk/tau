import { createLinkPeer, type PeerServer } from "./link-peer";
import type { AttachPeer } from "./peer-seam";

/** `server.attachPeer`: one symmetric link implementation for both roles. */
export function createAttachPeer(server: PeerServer): AttachPeer {
  return (socket, role, peer) => createLinkPeer({ socket, role, server, peer });
}
