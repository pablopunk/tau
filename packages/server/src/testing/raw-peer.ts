import {
  CHUNK_BYTES,
  CREDIT_WINDOW_BYTES,
  chunkBody,
  type DataFrame,
  decodeDataFrame,
  encodeDataFrame,
  firstStreamId,
  type HelloFrame,
  LINK_PROTOCOL,
  type LinkFrame,
  type LinkRole,
  NODE_CAPABILITIES,
  PROTOCOL_VERSION,
} from "@tau/protocol";
import {
  createHello,
  DOMAIN_TAGS,
  type NodeKeys,
  nodeIdOf,
  signedPayload,
  signPayload,
} from "@tau/protocol/identity";
import WebSocket, { WebSocketServer } from "ws";

export interface RawRequest {
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly via: string;
  readonly contentType?: string;
  readonly body: Buffer;
}
export interface RawResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}
export interface RawStream {
  /** Resolves when the other end sent `ready`. */
  readonly ready: Promise<void>;
  readonly messages: Array<{ payload: Buffer; text: boolean }>;
  readonly closed: Promise<{ code: number; reason: string }>;
  send(payload: Uint8Array, text?: boolean): void;
  close(code?: number): void;
}
export interface RawHandlers {
  request(request: RawRequest): Promise<RawResponse> | RawResponse;
  /** `send` goes to the other end under its credit; return what to do with its messages. */
  open?(
    path: string,
    send: (payload: Uint8Array, text?: boolean) => void,
  ): { onMessage?(payload: Buffer, text: boolean): void };
}
export interface RawPeerOptions {
  readonly keys: NodeKeys;
  readonly role: LinkRole;
  readonly handlers?: RawHandlers;
  readonly hello?: Partial<HelloFrame>;
  /** Never send credit for what arrives (a stuck peer). */
  readonly withholdCredit?: boolean;
  /** Do not answer the other end's `hello` with a `proof` (the test sends frames by hand). */
  readonly manualProof?: boolean;
  /** Do not send our `hello` on open either (a test sends it, or a `proof` first). */
  readonly silent?: boolean;
  /** Do not send `ready` for an `open` until the test calls `sendReady`. */
  readonly holdReady?: boolean;
}

interface Upload {
  readonly frame: Extract<LinkFrame, { type: "request" }>;
  readonly chunks: Buffer[];
  received: number;
}
interface Waiting {
  readonly chunks: Buffer[];
  head?: { status: number; headers: Record<string, string> };
  readonly resolve: (response: RawResponse) => void;
}

/** The link protocol from scratch, in the tests: a node with a real key that speaks `hello`, `proof`, streams and credit. */
export class RawPeer {
  readonly nodeId: string;
  readonly controlFrames: LinkFrame[] = [];
  readonly closeFrames: Array<{ id: number; code: number }> = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  readonly established: Promise<void>;
  maxDataFrame = 0;
  private resolveEstablished: () => void = () => undefined;
  private ownHello: HelloFrame;
  private nextId: number;
  private readonly uploads = new Map<number, Upload>();
  private readonly waiting = new Map<number, Waiting>();
  private readonly streams = new Map<number, { onMessage?(payload: Buffer, text: boolean): void }>();
  private readonly mine = new Map<
    number,
    { stream: RawStream; resolveReady(): void; resolveClosed(v: { code: number; reason: string }): void }
  >();
  private readonly credit = new Map<number, number>();
  private readonly outbox = new Map<number, DataFrame[]>();
  private readonly owed = new Map<number, number>();
  private pongWaiters: Array<() => void> = [];

  constructor(
    readonly socket: WebSocket,
    private readonly options: RawPeerOptions,
  ) {
    this.nodeId = nodeIdOf(options.keys.publicKey);
    this.nextId = firstStreamId(options.role);
    this.ownHello = {
      ...createHello(options.keys, {
        name: "Raw peer",
        os: "test",
        tauVersion: "0.0.0",
        protocolVersion: PROTOCOL_VERSION,
        linkProtocol: LINK_PROTOCOL,
        capabilities: [...NODE_CAPABILITIES],
      }),
      ...options.hello,
    };
    this.established = new Promise((resolve) => {
      this.resolveEstablished = resolve;
    });
    this.closed = new Promise((resolve) =>
      socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() })),
    );
    socket.on("message", (data, isBinary) => {
      const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
      if (isBinary) return this.onData(bytes);
      this.onControl(JSON.parse(bytes.toString("utf8")) as LinkFrame);
    });
    socket.on("error", () => undefined);
    if (options.silent) return;
    if (socket.readyState === WebSocket.OPEN) this.sendHello();
    else socket.once("open", () => this.sendHello());
  }

  sendHello(): void {
    this.sendControl(this.ownHello);
  }

  sendReady(id: number): void {
    this.sendControl({ type: "ready", id });
  }

  /** Frames of one type received so far. */
  received<T extends LinkFrame["type"]>(type: T): Array<Extract<LinkFrame, { type: T }>> {
    return this.controlFrames.filter(
      (frame): frame is Extract<LinkFrame, { type: T }> => frame.type === type,
    );
  }

  dataFramesReceived = 0;

  sendControl(frame: unknown): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(frame));
  }

  sendData(frame: DataFrame): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(encodeDataFrame(frame));
  }

  ping(): Promise<void> {
    return new Promise((resolve) => {
      this.pongWaiters.push(resolve);
      this.sendControl({ type: "ping" });
    });
  }

  /** `proof` for the other end's `hello`, signed with this peer's key. */
  proofFor(hello: Pick<HelloFrame, "nonce" | "nodeId">): unknown {
    const payload = signedPayload(DOMAIN_TAGS.proof, hello.nonce, this.nodeId, hello.nodeId);
    return { type: "proof", payload, sig: signPayload(this.options.keys, payload) };
  }

  get hello(): HelloFrame {
    return this.ownHello;
  }

  /** A request from this peer to the other end's responder. */
  request(request: {
    method?: string;
    path: string;
    query?: string;
    body?: Buffer;
    contentType?: string;
    via?: string;
  }): Promise<RawResponse> {
    const id = this.allocate();
    const body = request.body && request.body.length > 0 ? request.body : undefined;
    return new Promise((resolve) => {
      this.waiting.set(id, { chunks: [], resolve });
      this.sendControl({
        type: "request",
        id,
        method: request.method ?? "GET",
        path: request.path,
        query: request.query ?? "",
        via: request.via ?? "raw peer",
        ...(request.contentType ? { contentType: request.contentType } : {}),
        ...(body ? { bodyBytes: body.length } : {}),
      });
      if (body) this.outbox.set(id, [...chunkBody(id, body)]);
      this.flush();
    });
  }

  /** A socket stream from this peer to the other end's responder (`/api/live`, a terminal). */
  openStream(path: string, query = ""): RawStream {
    const id = this.allocate();
    let resolveReady: () => void = () => undefined;
    let resolveClosed: (value: { code: number; reason: string }) => void = () => undefined;
    const stream: RawStream = {
      ready: new Promise((resolve) => (resolveReady = resolve)),
      messages: [],
      closed: new Promise((resolve) => (resolveClosed = resolve)),
      send: (payload, text = false) => {
        for (const piece of chunkBody(id, payload, text)) this.queue(id, { ...piece, end: false });
        this.flush();
      },
      close: (code = 1000) => this.sendControl({ type: "close", id, code, reason: "" }),
    };
    this.mine.set(id, { stream, resolveReady, resolveClosed });
    this.sendControl({ type: "open", id, path, query, via: "raw peer" });
    return stream;
  }

  allocate(): number {
    const id = this.nextId;
    this.nextId += 2;
    return id;
  }

  private onControl(frame: LinkFrame): void {
    this.controlFrames.push(frame);
    switch (frame.type) {
      case "hello":
        if (!this.options.manualProof) this.sendControl(this.proofFor(frame));
        return;
      case "proof":
        this.resolveEstablished();
        return;
      case "ping":
        return void this.sendControl({ type: "pong" });
      case "pong":
        return void this.pongWaiters.splice(0).forEach((resolve) => void resolve());
      case "request":
        return void this.onRequest(frame);
      case "open":
        return void this.onOpen(frame);
      case "ready":
        return void this.mine.get(frame.id)?.resolveReady();
      case "response": {
        const waiting = this.waiting.get(frame.id);
        if (waiting) waiting.head = { status: frame.status, headers: frame.headers };
        return;
      }
      case "credit":
        this.credit.set(frame.id, (this.credit.get(frame.id) ?? CREDIT_WINDOW_BYTES) + frame.bytes);
        return void this.flush();
      case "close": {
        this.closeFrames.push({ id: frame.id, code: frame.code });
        this.streams.delete(frame.id);
        const mine = this.mine.get(frame.id);
        mine?.resolveClosed({ code: frame.code, reason: frame.reason });
        this.mine.delete(frame.id);
        return;
      }
      default:
    }
  }

  private onRequest(frame: Extract<LinkFrame, { type: "request" }>): void {
    this.uploads.set(frame.id, { frame, chunks: [], received: 0 });
    if (!frame.bodyBytes) void this.answer(frame.id);
  }

  private onOpen(frame: Extract<LinkFrame, { type: "open" }>): void {
    const open = this.options.handlers?.open;
    if (!open)
      return void this.sendControl({ type: "close", id: frame.id, code: 1011, reason: "no streams" });
    const send = (payload: Uint8Array, text = false) => {
      for (const piece of chunkBody(frame.id, payload, text)) this.queue(frame.id, { ...piece, end: false });
      this.flush();
    };
    this.streams.set(frame.id, open(frame.path, send));
    if (!this.options.holdReady) this.sendReady(frame.id);
  }

  private onData(bytes: Buffer): void {
    const frame = decodeDataFrame(bytes);
    if (!frame) return;
    this.dataFramesReceived++;
    this.maxDataFrame = Math.max(this.maxDataFrame, frame.payload.byteLength);
    this.grant(frame.id, frame.payload.byteLength);
    const upload = this.uploads.get(frame.id);
    const waiting = this.waiting.get(frame.id);
    const payload = Buffer.from(frame.payload);
    if (upload) {
      upload.chunks.push(payload);
      upload.received += payload.byteLength;
      if (upload.received >= (upload.frame.bodyBytes ?? 0)) void this.answer(frame.id);
    } else if (waiting) {
      waiting.chunks.push(payload);
      if (frame.end && waiting.head) {
        this.waiting.delete(frame.id);
        waiting.resolve({ ...waiting.head, body: Buffer.concat(waiting.chunks) });
      }
    } else if (this.mine.has(frame.id)) {
      this.mine.get(frame.id)?.stream.messages.push({ payload, text: frame.text });
    } else {
      this.streams.get(frame.id)?.onMessage?.(payload, frame.text);
    }
  }

  private grant(id: number, bytes: number): void {
    if (this.options.withholdCredit || bytes === 0) return;
    const owed = (this.owed.get(id) ?? 0) + bytes;
    if (owed < CHUNK_BYTES) return void this.owed.set(id, owed);
    this.owed.set(id, 0);
    this.sendControl({ type: "credit", id, bytes: owed });
  }

  private async answer(id: number): Promise<void> {
    const upload = this.uploads.get(id);
    const handler = this.options.handlers?.request;
    if (!upload || !handler) return;
    this.uploads.delete(id);
    const { frame } = upload;
    const response = await handler({
      method: frame.method,
      path: frame.path,
      query: frame.query,
      via: frame.via,
      contentType: frame.contentType,
      body: Buffer.concat(upload.chunks),
    });
    this.sendControl({ type: "response", id, status: response.status, headers: response.headers });
    this.outbox.set(id, [...chunkBody(id, response.body)]);
    this.flush();
  }

  private queue(id: number, frame: DataFrame): void {
    const list = this.outbox.get(id) ?? [];
    list.push(frame);
    this.outbox.set(id, list);
  }

  /** Sends queued frames under the other end's credit, one chunk per stream per pass. */
  flush(): void {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [id, list] of this.outbox) {
        const head = list[0];
        const credit = this.credit.get(id) ?? CREDIT_WINDOW_BYTES;
        if (!head || credit < head.payload.byteLength) continue;
        list.shift();
        this.credit.set(id, credit - head.payload.byteLength);
        this.sendData(head);
        if (list.length === 0) this.outbox.delete(id);
        progressed = true;
      }
    }
  }

  stop(): void {
    this.socket.terminate();
  }
}

export interface RawServer {
  readonly url: string;
  /** The next link a dialler opens to this server, as an acceptor. */
  nextPeer(): Promise<RawPeer>;
  close(): Promise<void>;
}

/** A listening raw peer, for the case where the server under test is the dialler. */
export async function listenRawPeer(options: Omit<RawPeerOptions, "role">): Promise<RawServer> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0, maxPayload: 2 * 1024 * 1024 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const waiters: Array<(peer: RawPeer) => void> = [];
  const ready: RawPeer[] = [];
  server.on("connection", (socket) => {
    const peer = new RawPeer(socket, { ...options, role: "acceptor" });
    const waiter = waiters.shift();
    if (waiter) waiter(peer);
    else ready.push(peer);
  });
  const { port } = server.address() as { port: number };
  return {
    url: `ws://127.0.0.1:${port}`,
    nextPeer: () => {
      const peer = ready.shift();
      return peer ? Promise.resolve(peer) : new Promise((resolve) => waiters.push(resolve));
    },
    close: () =>
      new Promise((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => resolve());
      }),
  };
}

/** A raw peer that dials a real server's link route with a node secret (the server is the acceptor). */
export async function dialRawPeer(
  url: string,
  secret: string,
  options: Omit<RawPeerOptions, "role">,
): Promise<RawPeer> {
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${secret}` } });
  const peer = new RawPeer(socket, { ...options, role: "dialler" });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) =>
      reject(new Error(`refused ${response.statusCode}`)),
    );
  });
  return peer;
}
