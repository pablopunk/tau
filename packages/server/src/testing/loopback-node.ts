import {
  CHUNK_BYTES,
  CREDIT_WINDOW_BYTES,
  chunkBody,
  type DataFrame,
  decodeDataFrame,
  encodeDataFrame,
  type LegacyLinkFrame,
  type LegacyNodeHello,
  NODE_LINK_PATH,
  PROTOCOL_VERSION,
} from "@tau/protocol";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";

export interface PeerRequest {
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly hubDevice: string;
  readonly contentType?: string;
  readonly body: Buffer;
}
export interface PeerResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}
/** What a proxied socket does on the node: `send` goes to the browser under the hub's credit. */
export interface PeerStream {
  onMessage?(payload: Buffer, text: boolean): void;
  onClose?(code: number, reason: string): void;
}
export interface PeerHandlers {
  request(request: PeerRequest): Promise<PeerResponse> | PeerResponse;
  /** Called on `open`; the peer confirms the stream by echoing `open` first. */
  open?(
    path: string,
    send: (payload: Uint8Array, text?: boolean) => void,
    close: (code: number, reason: string) => void,
  ): PeerStream;
}
export interface LoopbackNodeOptions {
  readonly port: number;
  readonly secret: string;
  readonly handlers: PeerHandlers;
  readonly hello?: Partial<LegacyNodeHello>;
  /** Never send credit for incoming bodies and stream data (a stuck node). */
  readonly withholdCredit?: boolean;
}

export interface LoopbackNode {
  readonly socket: WebSocket;
  /** Resolves when the hub closes or the peer closes; the code. */
  readonly closed: Promise<number>;
  /** Sends a ping and resolves when the hub's pong arrives (the hub then saw a frame). */
  ping(): Promise<void>;
  /** Every `close` frame the hub sent: stream id, code. */
  readonly closeFrames: Array<{ id: number; code: number }>;
  /** Sizes of the largest data frame seen, to prove chunking. */
  readonly maxDataFrame: () => number;
  stop(): void;
}

interface Upload {
  readonly frame: Extract<LegacyLinkFrame, { type: "request" }>;
  readonly chunks: Buffer[];
  received: number;
}

/** A fake link client speaking the frames: the node side of the multiplexer, for tests. */
export async function connectLoopbackNode(options: LoopbackNodeOptions): Promise<LoopbackNode> {
  const socket = new WebSocket(`ws://127.0.0.1:${options.port}${NODE_LINK_PATH}`, {
    headers: { authorization: `Bearer ${options.secret}` },
  });
  const closed = new Promise<number>((resolve) => socket.once("close", resolve));
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) =>
      reject(new Error(`link refused: ${response.statusCode}`)),
    );
  });
  const peer = new PeerLink(socket, options);
  peer.sendHello();
  return {
    socket,
    closed,
    ping: () => peer.ping(),
    closeFrames: peer.closeFrames,
    maxDataFrame: () => peer.maxData,
    stop: () => socket.terminate(),
  };
}

class PeerLink {
  readonly closeFrames: Array<{ id: number; code: number }> = [];
  maxData = 0;
  private readonly uploads = new Map<number, Upload>();
  private readonly streams = new Map<number, PeerStream>();
  private readonly credit = new Map<number, number>();
  private readonly outbox = new Map<number, DataFrame[]>();
  private readonly owed = new Map<number, number>();
  private pongWaiters: Array<() => void> = [];

  constructor(
    private readonly socket: WebSocket,
    private readonly options: LoopbackNodeOptions,
  ) {
    socket.on("message", (data, isBinary) => {
      const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
      if (isBinary) return this.onData(bytes);
      this.onControl(JSON.parse(bytes.toString("utf8")) as LegacyLinkFrame);
    });
  }

  sendHello(): void {
    const hello: LegacyNodeHello = {
      name: "Loopback",
      os: "test",
      tauVersion: "0.0.0",
      protocolVersion: PROTOCOL_VERSION,
      threadCount: 0,
      ...this.options.hello,
    };
    this.control({ type: "hello", ...hello });
  }

  ping(): Promise<void> {
    return new Promise((resolve) => {
      this.pongWaiters.push(resolve);
      this.control({ type: "ping" });
    });
  }

  private control(frame: LegacyLinkFrame): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(frame));
  }

  private onControl(frame: LegacyLinkFrame): void {
    switch (frame.type) {
      case "ping":
        this.control({ type: "pong" });
        return;
      case "pong":
        return void this.pongWaiters.splice(0).forEach((resolve) => void resolve());
      case "request":
        this.onRequest(frame);
        return;
      case "open":
        this.onOpen(frame);
        return;
      case "credit":
        this.credit.set(frame.id, (this.credit.get(frame.id) ?? CREDIT_WINDOW_BYTES) + frame.bytes);
        this.flush();
        return;
      case "close":
        this.closeFrames.push({ id: frame.id, code: frame.code });
        this.streams.get(frame.id)?.onClose?.(frame.code, frame.reason);
        this.streams.delete(frame.id);
        return;
      default:
        return;
    }
  }

  private onRequest(frame: Extract<LegacyLinkFrame, { type: "request" }>): void {
    this.uploads.set(frame.id, { frame, chunks: [], received: 0 });
    if (!frame.bodyBytes) void this.answer(frame.id);
  }

  private onData(bytes: Buffer): void {
    const frame = decodeDataFrame(bytes);
    if (!frame) return;
    this.maxData = Math.max(this.maxData, frame.payload.byteLength);
    const upload = this.uploads.get(frame.id);
    if (upload) {
      upload.chunks.push(Buffer.from(frame.payload));
      upload.received += frame.payload.byteLength;
      this.grant(frame.id, frame.payload.byteLength);
      if (upload.received >= (upload.frame.bodyBytes ?? 0)) void this.answer(frame.id);
      return;
    }
    this.grant(frame.id, frame.payload.byteLength);
    this.streams.get(frame.id)?.onMessage?.(Buffer.from(frame.payload), frame.text);
  }

  private grant(id: number, bytes: number): void {
    if (this.options.withholdCredit) return;
    const owed = (this.owed.get(id) ?? 0) + bytes;
    if (owed < CHUNK_BYTES) return void this.owed.set(id, owed);
    this.owed.set(id, 0);
    this.control({ type: "credit", id, bytes: owed });
  }

  private async answer(id: number): Promise<void> {
    const upload = this.uploads.get(id);
    if (!upload) return;
    this.uploads.delete(id);
    const { frame } = upload;
    const response = await this.options.handlers.request({
      method: frame.method,
      path: frame.path,
      query: frame.query,
      hubDevice: frame.via,
      contentType: frame.contentType,
      body: Buffer.concat(upload.chunks),
    });
    this.control({ type: "response", id, status: response.status, headers: response.headers });
    this.outbox.set(id, [...chunkBody(id, response.body)]);
    this.flush();
  }

  private onOpen(frame: Extract<LegacyLinkFrame, { type: "open" }>): void {
    const { handlers } = this.options;
    if (!handlers.open) {
      this.control({ type: "close", id: frame.id, code: 1011, reason: "no streams" });
      return;
    }
    const send = (payload: Uint8Array, text = false) => {
      for (const piece of chunkBody(frame.id, payload, text)) {
        this.queue(frame.id, { ...piece, end: false });
      }
      this.flush();
    };
    const close = (code: number, reason: string) =>
      this.control({ type: "close", id: frame.id, code, reason });
    this.streams.set(frame.id, handlers.open(frame.path, send, close));
    this.control({ type: "open", id: frame.id, path: frame.path, query: frame.query, via: "" });
  }

  private queue(id: number, frame: DataFrame): void {
    const list = this.outbox.get(id) ?? [];
    list.push(frame);
    this.outbox.set(id, list);
  }

  /** Sends queued frames under the hub's credit, one chunk per stream per pass. */
  private flush(): void {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [id, list] of this.outbox) {
        const head = list[0];
        const credit = this.credit.get(id) ?? CREDIT_WINDOW_BYTES;
        if (!head || credit < head.payload.byteLength) continue;
        list.shift();
        this.credit.set(id, credit - head.payload.byteLength);
        this.socket.send(encodeDataFrame(head));
        if (list.length === 0) this.outbox.delete(id);
        progressed = true;
      }
    }
  }
}

/** A node handler backed by a real Fastify app (`inject`), so the hub talks to real routes. */
export function fastifyHandler(app: FastifyInstance): PeerHandlers["request"] {
  return async (request) => {
    const response = await app.inject({
      method: request.method as "GET",
      url: `${request.path}${request.query ? `?${request.query}` : ""}`,
      payload: request.body.length > 0 ? request.body : undefined,
      headers: {
        ...(request.contentType ? { "content-type": request.contentType } : {}),
        "x-tau-via": request.hubDevice,
      },
    });
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(response.headers)) {
      if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(", ") : String(value);
    }
    return { status: response.statusCode, headers, body: response.rawPayload };
  };
}
