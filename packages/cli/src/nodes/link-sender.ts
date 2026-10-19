import { CREDIT_WINDOW_BYTES, type DataFrame, encodeDataFrame } from "@tau/protocol";
import type WebSocket from "ws";

const BUFFER_LIMIT = 1024 * 1024;
const BUFFER_POLL_MS = 5;

interface Queued {
  readonly frame: DataFrame;
  readonly done: (sent: boolean) => void;
}

interface Lane {
  credit: number;
  readonly queue: Queued[];
}

/** One outgoing data lane per stream: credit window, round-robin between streams, `bufferedAmount` backpressure. */
export interface LinkSender {
  /** Resolves `true` once the frame went out, `false` when the stream or the link was closed first. */
  push(frame: DataFrame): Promise<boolean>;
  addCredit(id: number, bytes: number): void;
  /** Bytes waiting for credit on a stream. */
  pending(id: number): number;
  /** Drops a stream's queue; its waiting pushes resolve `false`. */
  drop(id: number): void;
  closeAll(): void;
}

export function createLinkSender(
  socket: WebSocket,
  onDrained: (id: number) => void = () => undefined,
): LinkSender {
  const lanes = new Map<number, Lane>();
  const pendingBytes = new Map<number, number>();
  let pumping = false;
  let closed = false;

  const laneOf = (id: number): Lane => {
    const existing = lanes.get(id);
    if (existing) return existing;
    const lane: Lane = { credit: CREDIT_WINDOW_BYTES, queue: [] };
    lanes.set(id, lane);
    return lane;
  };

  const sendable = (lane: Lane): boolean => {
    const head = lane.queue[0];
    return head !== undefined && lane.credit >= head.frame.payload.byteLength;
  };

  function sendOne(id: number, lane: Lane): void {
    const item = lane.queue.shift() as Queued;
    lane.credit -= item.frame.payload.byteLength;
    pendingBytes.set(id, (pendingBytes.get(id) ?? 0) - item.frame.payload.byteLength);
    socket.send(encodeDataFrame(item.frame), { binary: true }, () => undefined);
    item.done(true);
    onDrained(id);
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (!closed) {
        const ready = [...lanes].filter(([, lane]) => sendable(lane));
        if (ready.length === 0) return;
        if (socket.bufferedAmount > BUFFER_LIMIT) {
          await new Promise((resolve) => setTimeout(resolve, BUFFER_POLL_MS));
          continue;
        }
        for (const [id, lane] of ready) sendOne(id, lane);
        await new Promise((resolve) => setImmediate(resolve));
      }
    } finally {
      pumping = false;
    }
  }

  return {
    push(frame) {
      if (closed) return Promise.resolve(false);
      return new Promise((resolve) => {
        laneOf(frame.id).queue.push({ frame, done: resolve });
        pendingBytes.set(frame.id, (pendingBytes.get(frame.id) ?? 0) + frame.payload.byteLength);
        void pump();
      });
    },
    addCredit(id, bytes) {
      const lane = lanes.get(id);
      if (!lane) return;
      lane.credit += bytes;
      void pump();
    },
    pending: (id) => pendingBytes.get(id) ?? 0,
    drop(id) {
      for (const item of lanes.get(id)?.queue ?? []) item.done(false);
      lanes.delete(id);
      pendingBytes.delete(id);
    },
    closeAll() {
      closed = true;
      for (const id of [...lanes.keys()]) this.drop(id);
    },
  };
}
