import type { WebSocket } from "ws";

/** One proxied HTTP call: the hub never parses the body, the node validates it. */
export interface GatewayRequest {
  readonly method: string;
  /** Already filtered by `filterProxyPath`; no query. */
  readonly path: string;
  readonly query: string;
  /** Label of the hub device, sent as `x-tau-hub-device`. */
  readonly hubDevice: string;
  readonly contentType?: string;
  readonly body?: Buffer;
}

export interface GatewayResponse {
  readonly status: number;
  /** Not yet filtered: the proxy applies `filterResponseHeaders`. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}

export interface GatewayStreamRequest {
  readonly path: string;
  readonly query: string;
  readonly hubDevice: string;
}

/**
 * What the proxy needs from the link multiplexer (owner G implements it in `nodes/`, frozen in Phase 0).
 * `acceptLink` takes the link socket after the guard authenticated a node (`deviceId` is the node id).
 */
export interface NodeGateway {
  acceptLink(nodeId: string, socket: WebSocket): void;
  isOnline(nodeId: string): boolean;
  /** Rejects `not_found` for a node that is not linked now. */
  request(nodeId: string, request: GatewayRequest): Promise<GatewayResponse>;
  /** Pipes a browser socket to a stream on the node; closes `socket` with 1013 on overflow or when the node goes. */
  openStream(nodeId: string, request: GatewayStreamRequest, socket: WebSocket): void;
  closeNode(nodeId: string): void;
}
