import { createServer, type Server, type Socket } from "node:net";
import type { FastifyInstance } from "fastify";
import { parseProxyV2 } from "./proxy-v2";
import type { TunnelTagWriter } from "./tunnel-tags";

export const PROXY_HEADER_TIMEOUT_MS = 5000;
const MAX_HEADER_BYTES = 16 + 65535;

export interface TunnelListenerOptions {
  readonly app: FastifyInstance;
  readonly tags: TunnelTagWriter;
  /** The tunnel hostname right now; `undefined` while remote is off (every socket is then destroyed). */
  readonly hostname: () => string | undefined;
  readonly headerTimeoutMs?: number;
}

export interface TunnelListener {
  /** `127.0.0.1:<port>`: the target of the tunnel route `@`. */
  start(): Promise<{ readonly port: number }>;
  close(): Promise<void>;
}

/** Tag first, then hand the socket to the HTTP server: unshift the rest, emit `connection`, resume. */
function admit(
  options: TunnelListenerOptions,
  socket: Socket,
  peer: string,
  sni: string,
  rest: Buffer,
): void {
  options.tags.tag(socket, { peer, sni });
  if (rest.length > 0) socket.unshift(rest);
  options.app.server.emit("connection", socket);
  socket.resume();
}

function handleConnection(options: TunnelListenerOptions, socket: Socket): void {
  let buffered = Buffer.alloc(0);
  const timer = setTimeout(() => socket.destroy(), options.headerTimeoutMs ?? PROXY_HEADER_TIMEOUT_MS);
  const onData = (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    const parsed = parseProxyV2(buffered);
    if (parsed.kind === "need-more" && buffered.length <= MAX_HEADER_BYTES) return;
    clearTimeout(timer);
    socket.off("data", onData);
    socket.pause();
    const hostname = options.hostname();
    if (parsed.kind !== "ok" || hostname === undefined || parsed.sni?.toLowerCase() !== hostname) {
      return void socket.destroy();
    }
    admit(options, socket, parsed.peer, hostname, parsed.rest);
  };
  socket.on("data", onData);
  socket.on("error", () => socket.destroy());
  socket.on("close", () => clearTimeout(timer));
}

export function createTunnelListener(options: TunnelListenerOptions): TunnelListener {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    handleConnection(options, socket);
  });
  return {
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject);
          const address = server.address();
          resolve({ port: typeof address === "object" && address ? address.port : 0 });
        });
      }),
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
