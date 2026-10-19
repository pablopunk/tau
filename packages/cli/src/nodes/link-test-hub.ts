import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CHUNK_BYTES, chunkBody, decodeDataFrame, encodeDataFrame, type LinkFrame } from "@tau/protocol";
import { type WebSocket, WebSocketServer } from "ws";

/** A scripted hub for tests: one link socket, recorded frames, credit-aware senders. */
export interface TestHub {
  readonly url: string;
  readonly upgrades: IncomingHttpHeaders[];
  readonly frames: LinkFrame[];
  readonly data: Map<number, Buffer[]>;
  readonly ends: Set<number>;
  readonly textFlags: Map<number, boolean[]>;
  /** Refuse the next upgrades with this status instead of accepting. */
  refuseWith: number | undefined;
  socket(): Promise<WebSocket>;
  sendFrame(frame: LinkFrame): Promise<void>;
  /** Sends a body honouring the node's credits. */
  sendBody(id: number, body: Uint8Array): Promise<void>;
  sendData(id: number, payload: Uint8Array, text: boolean): Promise<void>;
  /** Grants credit for everything received (the default); turn off to test the window. */
  autoCredit: boolean;
  waitFor(predicate: () => boolean, ms?: number): Promise<void>;
  close(): Promise<void>;
}

export async function startTestHub(): Promise<TestHub> {
  const http: Server = createServer();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  const sockets: WebSocket[] = [];
  const waiters: Array<() => void> = [];
  const credits = new Map<number, number>();
  const hub: TestHub = {
    url: "",
    upgrades: [],
    frames: [],
    data: new Map(),
    ends: new Set(),
    textFlags: new Map(),
    refuseWith: undefined,
    autoCredit: true,
    socket: async () => {
      await hub.waitFor(() => sockets.length > 0);
      return sockets[sockets.length - 1] as WebSocket;
    },
    sendFrame: async (frame) => void (await hub.socket()).send(JSON.stringify(frame)),
    sendData: async (id, payload, text) => {
      const socket = await hub.socket();
      for (const part of chunkBody(id, payload, text)) {
        await hub.waitFor(() => (credits.get(id) ?? 1024 * 1024) >= part.payload.byteLength, 20_000);
        credits.set(id, (credits.get(id) ?? 1024 * 1024) - part.payload.byteLength);
        socket.send(encodeDataFrame({ ...part, end: false }), { binary: true });
      }
    },
    sendBody: async (id, body) => {
      const socket = await hub.socket();
      for (const part of chunkBody(id, body)) {
        await hub.waitFor(() => (credits.get(id) ?? 1024 * 1024) >= part.payload.byteLength, 20_000);
        credits.set(id, (credits.get(id) ?? 1024 * 1024) - part.payload.byteLength);
        socket.send(encodeDataFrame(part), { binary: true });
      }
    },
    waitFor: async (predicate, ms = 5000) => {
      const deadline = Date.now() + ms;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error("hub: timed out waiting");
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 10);
        });
      }
    },
    close: async () => {
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
  const wake = () => {
    for (const resolve of waiters.splice(0)) resolve();
  };

  http.on("upgrade", (request, tcp, head) => {
    hub.upgrades.push(request.headers);
    if (hub.refuseWith !== undefined) {
      tcp.end(`HTTP/1.1 ${hub.refuseWith} Refused\r\nConnection: close\r\n\r\n`);
      return wake();
    }
    wss.handleUpgrade(request, tcp, head, (socket) => {
      sockets.push(socket);
      socket.on("message", (raw, isBinary) => {
        const bytes = Buffer.isBuffer(raw) ? raw : Buffer.concat(raw as Buffer[]);
        if (!isBinary) {
          const frame = JSON.parse(bytes.toString()) as LinkFrame;
          hub.frames.push(frame);
          if (frame.type === "credit")
            credits.set(frame.id, (credits.get(frame.id) ?? 1024 * 1024) + frame.bytes);
          return wake();
        }
        const decoded = decodeDataFrame(bytes);
        if (!decoded) return;
        const list = hub.data.get(decoded.id) ?? [];
        list.push(Buffer.from(decoded.payload));
        hub.data.set(decoded.id, list);
        hub.textFlags.set(decoded.id, [...(hub.textFlags.get(decoded.id) ?? []), decoded.text]);
        if (decoded.end) hub.ends.add(decoded.id);
        if (hub.autoCredit && decoded.payload.byteLength > 0) {
          socket.send(JSON.stringify({ type: "credit", id: decoded.id, bytes: decoded.payload.byteLength }));
        }
        wake();
      });
      socket.on("close", wake);
      wake();
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  (hub as { url: string }).url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  return hub;
}

export const bodyOf = (hub: TestHub, id: number): Buffer => Buffer.concat(hub.data.get(id) ?? []);
export { CHUNK_BYTES };
