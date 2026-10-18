import type { ClientFrame, JsonRouteName, RouteInput, RouteOutput, routes, ServerFrame } from "@tau/protocol";

export type RouteRequest<N extends JsonRouteName> = RouteInput<(typeof routes)[N]>;
export type RouteResponse<N extends JsonRouteName> = RouteOutput<(typeof routes)[N]>;

export interface LiveHandlers {
  onOpen(): void;
  onFrame(frame: ServerFrame): void;
  /** The socket closed or failed to open; the owner decides whether to reconnect. */
  onClose(): void;
}

export interface LiveSocket {
  send(frame: ClientFrame): void;
  close(): void;
}

/** One WebSocket to `/api/live`, as frames. `LiveClient` (conversation/) builds views on top of it. */
export interface LiveTransport {
  open(handlers: LiveHandlers): LiveSocket;
}

export interface Transport {
  /** Rejects with `AppError`: the server's error code, or `internal` / `unauthorized` for anything else. */
  request<N extends JsonRouteName>(name: N, input: RouteRequest<N>): Promise<RouteResponse<N>>;
  readonly live: LiveTransport;
}
