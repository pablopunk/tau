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
  /**
   * Tags the loopback connection the tunnel listener opens to the HTTP server, by its source port. Call it before
   * the first byte is forwarded; the returned function removes the tag when that connection closes.
   */
  tagLoopbackPort(port: number, tag: SocketTag): () => void;
}

const LOOPBACK = new Set(["127.0.0.1", "::ffff:127.0.0.1", "::1"]);

export function createTunnelTags(): TunnelTagWriter {
  const tags = new WeakMap<Socket, SocketTag>();
  const byPort = new Map<number, SocketTag>();
  return {
    tagOf: (socket) => {
      const direct = tags.get(socket);
      if (direct) return direct;
      if (socket.remotePort === undefined || !LOOPBACK.has(socket.remoteAddress ?? "")) return undefined;
      return byPort.get(socket.remotePort);
    },
    tag: (socket, tag) => void tags.set(socket, tag),
    tagLoopbackPort(port, tag) {
      byPort.set(port, tag);
      return () => {
        if (byPort.get(port) === tag) byPort.delete(port);
      };
    },
  };
}
