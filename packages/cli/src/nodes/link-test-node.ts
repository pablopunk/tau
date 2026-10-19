import { createHash } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";

export const MASTER = "m".repeat(40);

/** A stand-in for the node's own server: a few HTTP routes and two sockets, checking the loopback contract. */
export interface TestNode {
  readonly port: number;
  readonly seen: IncomingHttpHeaders[];
  readonly socketHeaders: IncomingHttpHeaders[];
  readonly aborted: string[];
  /** Messages the `/api/live` socket received: [text?, bytes]. */
  readonly received: Array<{ text: boolean; size: number }>;
  close(): Promise<void>;
}

export async function startTestNode(): Promise<TestNode> {
  const big = Buffer.alloc(5 * 1024 * 1024, 7);
  const node: TestNode = {
    port: 0,
    seen: [],
    socketHeaders: [],
    aborted: [],
    received: [],
    close: async () => undefined,
  };
  const http: Server = createServer((request, response) => {
    node.seen.push(request.headers);
    if (request.url === "/api/big") return void response.end(big);
    if (request.url === "/api/endless") {
      const timer = setInterval(() => response.write(Buffer.alloc(64 * 1024, 1)), 5);
      response.on("close", () => {
        clearInterval(timer);
        node.aborted.push("endless");
      });
      return;
    }
    const hash = createHash("sha256");
    let bytes = 0;
    request.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      bytes += chunk.byteLength;
    });
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({ url: request.url, method: request.method, bytes, sha: hash.digest("hex") }),
      );
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  http.on("upgrade", (request, tcp, head) => {
    node.socketHeaders.push(request.headers);
    wss.handleUpgrade(request, tcp, head, (socket) => {
      socket.on("message", (data, isBinary) => {
        const bytes = Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]);
        node.received.push({ text: !isBinary, size: bytes.byteLength });
        socket.send(isBinary ? bytes : bytes.toString(), { binary: isBinary });
      });
      if (request.url?.startsWith("/api/flood")) {
        const timer = setInterval(() => socket.send(Buffer.alloc(64 * 1024, 2)), 1);
        socket.on("close", () => clearInterval(timer));
      }
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  (node as { port: number }).port = (http.address() as AddressInfo).port;
  node.close = async () => {
    for (const socket of wss.clients) socket.terminate();
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  };
  return node;
}

export const sha256 = (body: Uint8Array): string => createHash("sha256").update(body).digest("hex");
