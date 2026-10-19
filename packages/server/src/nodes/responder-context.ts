import type { LinkMux } from "./link-mux";

/** What the responder needs from its link: the stream table and the server it calls on loopback. */
export interface ResponderContext {
  readonly mux: LinkMux;
  /** The bound port of this server (`RunningServer.port`), never the configured one. */
  readonly port: number;
  /** The server's own master token for the loopback call: never logged, never forwarded. */
  readonly token: string;
}

/** The only headers the responder sends to its own server: never the peer's `Host`, `Origin`, `Cookie`, `Authorization`. */
export function loopbackHeaders(context: ResponderContext, via: string): Record<string, string> {
  return {
    host: `127.0.0.1:${context.port}`,
    authorization: `Bearer ${context.token}`,
    "x-tau-via": via,
  };
}
