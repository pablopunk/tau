import type { DataFrame } from "@tau/protocol";
import { CREDIT_WINDOW_BYTES } from "@tau/protocol";

/** One multiplexed stream on a link: a proxied request or a proxied socket. Outbound data waits for credit. */
export interface LinkStream {
  readonly id: number;
  /** Bytes the machine allows us to send now. Starts at the window; `credit` frames add. */
  credit: number;
  readonly pending: DataFrame[];
  pendingBytes: number;
  /** False until the machine confirms an `open`; requests are ready at once. */
  ready: boolean;
  /** Last time this stream moved (a send, a credit, a flush); the 60 s clock starts here. */
  progressAt: number;
  /** Bytes handed to the browser socket and not yet flushed (machine to browser). */
  inFlight: number;
  /** Flushed bytes not yet returned to the machine as credit. */
  owed: number;
  /** The machine's `response` frame (requests only). */
  onResponse?(status: number, headers: Record<string, string>): void;
  /** A response chunk or a socket message arrived. */
  onData(frame: DataFrame): void;
  /** The machine closed the stream (or the link went). */
  onClose(code: number, reason: string): void;
  /** The pending queue went below the window again. */
  onDrained?(): void;
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
