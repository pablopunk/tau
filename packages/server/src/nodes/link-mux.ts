import {
  CHUNK_BYTES,
  CREDIT_WINDOW_BYTES,
  type DataFrame,
  decodeDataFrame,
  encodeDataFrame,
  firstStreamId,
  isPeerStreamId,
  LINK_NO_CREDIT_CLOSE_MS,
  type LinkFrame,
  type LinkRole,
  STREAM_ID_STEP,
} from "@tau/protocol";
import type { WebSocket } from "ws";
import { isBlocked, type LinkStream } from "./link-stream";

const PUMP_RETRY_MS = 5;
const LINK_HIGH_WATER = 2 * CHUNK_BYTES;
const CREDIT_BATCH_BYTES = 64 * 1024;
const GOING_AWAY = 1001;

export type IncomingOpen = Extract<LinkFrame, { type: "request" | "open" }>;

export interface MuxEvents {
  /** A `request` or `open` the peer started, already checked for parity and reuse. */
  incoming(frame: IncomingOpen): void;
  /** The peer broke the stream rules: the link closes 1008. */
  violation(reason: string): void;
}

/** The stream table of one link: ids, credit, round-robin sending under `bufferedAmount`, frame dispatch. */
export class LinkMux {
  readonly streams = new Map<number, LinkStream>();
  private nextId: number;
  private pumpTimer: NodeJS.Timeout | undefined;
  private ended = false;

  constructor(
    readonly role: LinkRole,
    private readonly socket: WebSocket,
    private readonly events: MuxEvents,
  ) {
    this.nextId = firstStreamId(role);
  }

  allocateId(): number {
    const id = this.nextId;
    this.nextId += STREAM_ID_STEP;
    return id;
  }

  addStream(stream: LinkStream): void {
    this.streams.set(stream.id, stream);
  }

  removeStream(id: number): void {
    this.streams.delete(id);
  }

  sendControl(frame: LinkFrame): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(frame));
  }

  /** Sends credit for consumed bytes, batched; always when nothing is in flight so the sender never starves. */
  returnCredit(stream: LinkStream): void {
    if (stream.owed <= 0) return;
    if (stream.owed < CREDIT_BATCH_BYTES && stream.inFlight > 0) return;
    stream.held = Math.max(0, stream.held - stream.owed);
    this.sendControl({ type: "credit", id: stream.id, bytes: stream.owed });
    stream.owed = 0;
  }

  /** One chunk per ready stream per pass, until the link buffer is full or no stream can send. */
  pump(): void {
    if (this.ended) return;
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const stream of [...this.streams.values()]) {
        if (this.socket.bufferedAmount > LINK_HIGH_WATER) return void this.schedulePump();
        progressed = this.sendOne(stream) || progressed;
      }
    }
  }

  receiveBinary(bytes: Uint8Array): void {
    const frame = decodeDataFrame(bytes);
    if (!frame) return void this.events.violation("short data frame");
    const stream = this.streams.get(frame.id);
    if (!stream) return;
    stream.held += frame.payload.byteLength;
    stream.progressAt = Date.now();
    if (stream.held > CREDIT_WINDOW_BYTES) return void this.events.violation("credit window overrun");
    stream.onData(frame);
  }

  receiveControl(frame: LinkFrame): void {
    switch (frame.type) {
      case "request":
      case "open":
        return void this.receiveOpen(frame);
      case "credit":
        return void this.receiveCredit(frame.id, frame.bytes);
      case "ready":
        return void this.receiveReady(frame.id);
      case "response":
        return void this.streams.get(frame.id)?.onResponse?.(frame.status, frame.headers);
      case "close":
        return void this.receiveClose(frame.id, frame.code, frame.reason);
      default:
        return;
    }
  }

  /** The 60 s clock: a stream that waits for credit, a flush or inbound data and does not move is closed 1013. */
  checkStalled(now: number): void {
    for (const stream of [...this.streams.values()]) {
      const waiting = isBlocked(stream) || stream.inFlight > 0 || stream.awaitingInbound;
      if (waiting && now - stream.progressAt >= LINK_NO_CREDIT_CLOSE_MS) stream.onStalled();
    }
  }

  /** The link ended: every stream hears it. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    for (const stream of [...this.streams.values()]) stream.onClose(GOING_AWAY, "node went away");
    this.streams.clear();
  }

  /** `true` when `id` is one this end allocated (so a late `ready` for a closed stream is harmless). */
  private allocatedHere(id: number): boolean {
    return id < this.nextId && !isPeerStreamId(this.role, id);
  }

  private receiveOpen(frame: IncomingOpen): void {
    if (!isPeerStreamId(this.role, frame.id)) return void this.events.violation("wrong stream id parity");
    if (this.streams.has(frame.id)) return void this.events.violation("stream id in use");
    this.events.incoming(frame);
  }

  private receiveCredit(id: number, bytes: number): void {
    const stream = this.streams.get(id);
    if (!stream) return;
    stream.credit += bytes;
    stream.progressAt = Date.now();
    this.pump();
  }

  private receiveReady(id: number): void {
    const stream = this.streams.get(id);
    if (!stream) {
      if (!this.allocatedHere(id)) this.events.violation("ready for a stream never opened");
      return;
    }
    if (stream.ready) return void this.events.violation("stray ready");
    stream.ready = true;
    stream.progressAt = Date.now();
    stream.onReady?.();
    this.pump();
  }

  private receiveClose(id: number, code: number, reason: string): void {
    const stream = this.streams.get(id);
    if (!stream) return;
    this.streams.delete(id);
    stream.onClose(code, reason);
  }

  private sendOne(stream: LinkStream): boolean {
    const frame: DataFrame | undefined = stream.pending[0];
    if (!frame || isBlocked(stream)) return false;
    stream.pending.shift();
    stream.pendingBytes -= frame.payload.byteLength;
    stream.credit -= frame.payload.byteLength;
    stream.progressAt = Date.now();
    this.socket.send(encodeDataFrame(frame), { binary: true });
    stream.onSent?.(frame.payload.byteLength);
    if (stream.pendingBytes < CREDIT_WINDOW_BYTES) stream.onDrained?.();
    if (frame.end) stream.onSentEnd?.();
    return true;
  }

  private schedulePump(): void {
    if (this.pumpTimer) return;
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = undefined;
      this.pump();
    }, PUMP_RETRY_MS);
  }
}
