import type { DataFrame } from "@tau/protocol";
import { CREDIT_WINDOW_BYTES } from "@tau/protocol";

/** One multiplexed stream on a link, seen from either end: a request or a socket. Outbound data waits for credit. */
export interface LinkStream {
  readonly id: number;
  /** Bytes the peer allows us to send now. Starts at the window; `credit` frames add. */
  credit: number;
  readonly pending: DataFrame[];
  pendingBytes: number;
  /** False until the peer's `ready` (streams WE opened); requests and streams the peer opened are ready at once. */
  ready: boolean;
  /** Last time this stream moved (a send, a credit, a flush, an arrival); the 60 s clock starts here. */
  progressAt: number;
  /** Bytes handed to a local socket and not yet flushed. */
  inFlight: number;
  /** Consumed bytes not yet returned to the peer as credit. */
  owed: number;
  /** Bytes received and not yet returned as credit: more than the window is a protocol violation. */
  held: number;
  /** The handler expects inbound data (a request body): silence for 60 s ends the stream. */
  awaitingInbound: boolean;
  onResponse?(status: number, headers: Record<string, string>): void;
  onReady?(): void;
  /** A body chunk or a socket message arrived. */
  onData(frame: DataFrame): void;
  /** The peer closed the stream (or the link went). */
  onClose(code: number, reason: string): void;
  /** The pending queue went below the window again. */
  onDrained?(): void;
  /** The last queued frame with `end` went out. */
  onSentEnd?(): void;
  /** The stream stalled for 60 s: close it (1013). */
  onStalled(): void;
}

export function newStream(
  id: number,
  now: number,
  handlers: Pick<LinkStream, "onData" | "onClose" | "onStalled">,
  ready: boolean,
): LinkStream {
  return {
    id,
    credit: CREDIT_WINDOW_BYTES,
    pending: [],
    pendingBytes: 0,
    ready,
    progressAt: now,
    inFlight: 0,
    owed: 0,
    held: 0,
    awaitingInbound: false,
    ...handlers,
  };
}

export function enqueue(stream: LinkStream, frame: DataFrame): void {
  stream.pending.push(frame);
  stream.pendingBytes += frame.payload.byteLength;
}

export function isBlocked(stream: LinkStream): boolean {
  const head = stream.pending[0];
  return head !== undefined && (!stream.ready || stream.credit < head.payload.byteLength);
}

export const EMPTY_END = (id: number): DataFrame => ({
  id,
  end: true,
  text: false,
  payload: new Uint8Array(0),
});
