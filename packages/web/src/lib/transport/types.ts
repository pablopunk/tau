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

export interface StreamHandlers {
  onOpen(): void;
  /** A text frame as a string (a TypeBox schema), a binary frame as bytes. */
  onMessage(data: string | Uint8Array): void;
  /** The socket closed; `code` and `reason` are the WebSocket close code and reason. */
  onClose(code: number, reason: string): void;
}

export interface StreamSocket {
  send(data: string | Uint8Array): void;
  close(): void;
}

export interface RequestOptions {
  readonly signal?: AbortSignal;
}

export interface Transport {
  /** Rejects with `AppError` for server/network failures; cancellation retains the abort reason. */
  request<N extends JsonRouteName>(
    name: N,
    input: RouteRequest<N>,
    options?: RequestOptions,
  ): Promise<RouteResponse<N>>;
  readonly live: LiveTransport;
  /** One duplex WebSocket to `path` (for example `terminalStreamPath(id)`), text and binary frames. */
  openStream(path: string, handlers: StreamHandlers): StreamSocket;
}
