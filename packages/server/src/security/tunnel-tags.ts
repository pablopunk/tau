import type { Socket } from "node:net";

export interface SocketTag {
  /** The visitor's address from the PROXY header (IPv6 as hex), or `"local"` for a LOCAL header. */
  readonly peer: string;
  /** The SNI the visitor asked for (authority TLV). */
  readonly sni: string;
}

/** Provenance is the socket, never a header: only the tunnel listener tags a socket. */
export interface TunnelTags {
  tagOf(socket: Socket): SocketTag | undefined;
}

export interface TunnelTagWriter extends TunnelTags {
  tag(socket: Socket, tag: SocketTag): void;
}

export function createTunnelTags(): TunnelTagWriter {
  const tags = new WeakMap<Socket, SocketTag>();
  return {
    tagOf: (socket) => tags.get(socket),
    tag: (socket, tag) => void tags.set(socket, tag),
  };
}
