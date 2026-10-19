import type { LinkFrame } from "@tau/protocol";
import type { GatewayRequest, GatewayResponse, GatewayStreamRequest } from "../gateway";
import type { IncomingOpen } from "../link-mux";
import type { RegisteredLink } from "../link-registry";
import type { Refusal } from "./verify-local";

/** What the link peers and the registry call into: the relay's side of the link seam. */
export interface LinkHub {
  /** The link passed the handshake and is registered. */
  established(link: RegisteredLink): void;
  /** The registered link ended. */
  closed(link: RegisteredLink): void;
  /** `announce`, `expel`, `expel-ack` or `expel-sync` from a link. */
  control(link: RegisteredLink, frame: LinkFrame): void;
  /** A routed `request` or `open` whose `dest` is this node: checks the header; a refusal ends it. */
  verifyLocal(link: RegisteredLink, ownNodeId: string, frame: IncomingOpen): Refusal | undefined;
  /** A routed frame for another node: refuses it or forwards it. Returns the refusal to answer with. */
  forward(link: RegisteredLink, ownNodeId: string, frame: IncomingOpen): Refusal | undefined;
  /** A stream served here for a routed frame (so a tombstone of its origin can close it). */
  trackLocal(link: RegisteredLink, frame: IncomingOpen): void;
  /** `true` for a node that is reachable through the group (not only direct links). */
  reachable(nodeId: string): boolean;
  request(nodeId: string, request: GatewayRequest): Promise<GatewayResponse>;
  openStream(nodeId: string, request: GatewayStreamRequest, socket: import("ws").WebSocket): void;
}
