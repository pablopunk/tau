import {
  CHUNK_BYTES,
  type Core,
  CREDIT_WINDOW_BYTES,
  decodeDataFrame,
  encodeDataFrame,
  LINK_CLOSE_UPDATE_REQUIRED,
  LINK_NO_CREDIT_CLOSE_MS,
  LINK_OFFLINE_AFTER_MS,
  LINK_PING_INTERVAL_MS,
  type LinkFrame,
  LinkFrameSchema,
} from "@tau/protocol";
import { Value } from "typebox/value";
import type { RawData, WebSocket } from "ws";
import { isBlocked, type LinkStream } from "./link-stream";

const TICK_MS = 1000;
const HEARTBEAT_EVERY_MS = 1000;
const PUMP_RETRY_MS = 5;
const LINK_HIGH_WATER = 2 * CHUNK_BYTES;
const CREDIT_BATCH_BYTES = 64 * 1024;
const POLICY_VIOLATION = 1008;
const GOING_AWAY = 1001;
const INTERNAL = 1011;

export interface SessionEvents {
  /** The link ended (closed, silent, replaced or revoked); the gateway forgets it. */
  onEnded(): void;
}

function toBytes(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? Buffer.from(data) : data;
}

/** One machine's link: control frames, round-robin sending under credit, 15 s pings, 45 s silence. */
export class LinkSession {
  readonly streams = new Map<number, LinkStream>();
  registered = false;
  private nextId = 1;
  private lastFrameAt = Date.now();
  private lastPingAt = Date.now();
  private lastHeartbeatAt = 0;
  private pumpTimer: NodeJS.Timeout | undefined;
  private readonly ticker: NodeJS.Timeout;
  private ended = false;

  constructor(
    readonly machineId: string,
    private readonly socket: WebSocket,
    private readonly core: Core,
    private readonly events: SessionEvents,
  ) {
    socket.on("message", (data, isBinary) => this.receive(data, isBinary));
    socket.on("close", () => this.end());
    socket.on("error", () => undefined);
    this.ticker = setInterval(() => this.tick(), TICK_MS);
    this.ticker.unref();
  }

  allocateId(): number {
    return this.nextId++;
  }

  addStream(stream: LinkStream): void {
    this.streams.set(stream.id, stream);
  }

  sendControl(frame: LinkFrame): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(frame));
  }

  removeStream(id: number): void {
    this.streams.delete(id);
  }

  /** Sends credit for bytes consumed, batched; always when nothing is in flight so the sender never starves. */
  returnCredit(stream: LinkStream): void {
    if (stream.owed <= 0) return;
    if (stream.owed < CREDIT_BATCH_BYTES && stream.inFlight > 0) return;
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
        if (this.socket.bufferedAmount > LINK_HIGH_WATER) {
          this.schedulePump();
          return;
        }
        progressed = this.sendOne(stream) || progressed;
      }
    }
  }

  close(code: number, reason: string): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.close(code, reason);
    this.end();
  }

  private sendOne(stream: LinkStream): boolean {
    const frame = stream.pending[0];
    if (!frame || isBlocked(stream)) return false;
    stream.pending.shift();
    stream.pendingBytes -= frame.payload.byteLength;
    stream.credit -= frame.payload.byteLength;
    stream.progressAt = Date.now();
    this.socket.send(encodeDataFrame(frame));
    if (stream.pendingBytes < CREDIT_WINDOW_BYTES) stream.onDrained?.();
    return true;
  }

  private schedulePump(): void {
    if (this.pumpTimer) return;
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = undefined;
      this.pump();
    }, PUMP_RETRY_MS);
  }

  private receive(data: RawData, isBinary: boolean): void {
    const now = Date.now();
    this.lastFrameAt = now;
    if (now - this.lastHeartbeatAt >= HEARTBEAT_EVERY_MS) {
      this.lastHeartbeatAt = now;
      this.core.machines.heartbeat(this.machineId);
    }
    const bytes = toBytes(data);
    if (isBinary) {
      this.receiveData(bytes);
      return;
    }
    let frame: unknown;
    try {
      frame = JSON.parse(bytes.toString("utf8"));
    } catch {
      this.close(POLICY_VIOLATION, "bad frame");
      return;
    }
    if (!Value.Check(LinkFrameSchema, frame)) {
      this.close(POLICY_VIOLATION, "bad frame");
      return;
    }
    this.receiveControl(frame);
  }

  private receiveData(bytes: Buffer): void {
    const frame = decodeDataFrame(bytes);
    const stream = frame && this.streams.get(frame.id);
    if (!frame || !stream) return;
    stream.ready = true;
    stream.onData(frame);
  }

  private receiveControl(frame: LinkFrame): void {
    switch (frame.type) {
      case "hello":
        return void this.register(frame);
      case "ping":
        this.sendControl({ type: "pong" });
        return;
      case "credit": {
        const stream = this.streams.get(frame.id);
        if (!stream) return;
        stream.credit += frame.bytes;
        stream.progressAt = Date.now();
        this.pump();
        return;
      }
      case "open": {
        const stream = this.streams.get(frame.id);
        if (stream) stream.ready = true;
        this.pump();
        return;
      }
      case "response":
        return void this.streams.get(frame.id)?.onResponse?.(frame.status, frame.headers);
      case "close":
        return void this.streams.get(frame.id)?.onClose(frame.code, frame.reason);
      default:
        return;
    }
  }

  private async register(frame: Extract<LinkFrame, { type: "hello" }>): Promise<void> {
    if (this.registered) return;
    const { type: _type, ...hello } = frame;
    try {
      const machine = await this.core.machines.register(this.machineId, hello);
      this.registered = true;
      if (machine.status === "update-required") this.close(LINK_CLOSE_UPDATE_REQUIRED, "update required");
    } catch {
      this.close(INTERNAL, "register failed");
    }
  }

  private tick(): void {
    const now = Date.now();
    if (now - this.lastFrameAt >= LINK_OFFLINE_AFTER_MS) {
      this.close(GOING_AWAY, "no frames");
      return;
    }
    if (now - this.lastPingAt >= LINK_PING_INTERVAL_MS) {
      this.lastPingAt = now;
      this.sendControl({ type: "ping" });
      this.core.machines.heartbeat(this.machineId);
    }
    for (const stream of [...this.streams.values()]) this.checkStalled(stream, now);
  }

  private checkStalled(stream: LinkStream, now: number): void {
    const waiting = isBlocked(stream) || stream.inFlight > 0;
    if (waiting && now - stream.progressAt >= LINK_NO_CREDIT_CLOSE_MS) stream.onStalled();
  }

  private end(): void {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.ticker);
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    for (const stream of [...this.streams.values()]) stream.onClose(GOING_AWAY, "machine went away");
    this.streams.clear();
    this.events.onEnded();
  }
}
