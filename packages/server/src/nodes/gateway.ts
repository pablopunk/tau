/** One proxied HTTP call: the gateway never parses the body, the responder validates it. */
export interface GatewayRequest {
  readonly method: string;
  /** Already filtered by `filterProxyPath`; no query. */
  readonly path: string;
  readonly query: string;
  /** Label of whoever acted, sent as `via` and set as `x-tau-via` on the loopback call. */
  readonly via: string;
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
  readonly via: string;
}

/** Why a link is cut on purpose: the peer is told with `bye` and does not retry. */
export type CloseReason = "disconnect" | "forget" | "revoked";

/** What the proxy plugin needs from the links: requests and streams to the remote node, by `nodeId`. */
export interface NodeGateway {
  isOnline(nodeId: string): boolean;
  /** Rejects `not_found` for a node that is not linked now. */
  request(nodeId: string, request: GatewayRequest): Promise<GatewayResponse>;
  /** Pipes a browser socket to a stream on the node; closes `socket` with 1013 on overflow or when the node goes. */
  openStream(nodeId: string, request: GatewayStreamRequest, socket: import("ws").WebSocket): void;
  /** Sends `bye` and closes the link and every proxied stream (by `nodeId` or the peer id). */
  closeNode(nodeId: string, reason?: CloseReason): void;
}
