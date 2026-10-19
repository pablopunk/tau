import type { LinkRole } from "@tau/protocol";
import type { WebSocket } from "ws";

/**
 * FROZEN in Step 1 foundation. Everything the CLI's dialler (owner D) and the link route need from
 * `createLinkPeer` (owner B). One peer implementation serves both roles.
 */
export interface PeerInfo {
  /**
   * Dialler: the `peers.json` id (`peerIdOf(peer)`: its nodeId once known, else `u-<hash of url>`).
   * Acceptor: the node device id that authenticated the upgrade (`request.deviceId`).
   */
  readonly peerId: string;
  /** Dialler only: the `nodeId` pinned in `peers.json` or the pairing link; a different one is refused (1008). */
  readonly pinnedNodeId?: string;
  /** `sha256` hex of the node secret this link authenticated with: equal values are one device (glare case (a)). */
  readonly secretKey: string;
}

/** Why and when an attached link ended; the dialler turns it into a state and a backoff. */
export interface PeerClosed {
  readonly code: number;
  readonly reason: string;
  /** The handshake finished and the link was usable for some time. */
  readonly linked: boolean;
  /** The peer sent `bye` first: intended, never retried. */
  readonly bye: boolean;
}

export interface PeerHandle {
  /** Resolves once, whatever ended the link. */
  readonly closed: Promise<PeerClosed>;
  /** Sends `bye` (when `bye` is given) and closes the link and every stream proxied over it. */
  close(code?: number, reason?: string, bye?: boolean): void;
}

/** `server.attachPeer`: takes a socket that is already upgraded (acceptor) or open (dialler) and runs the link on it. */
export type AttachPeer = (socket: WebSocket, role: LinkRole, peer: PeerInfo) => PeerHandle;
