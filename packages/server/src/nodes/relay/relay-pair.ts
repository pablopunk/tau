import type { IncomingOpen, LinkMux } from "../link-mux";
import { enqueue, type LinkStream, newStream } from "../link-stream";
import { NO_CREDIT } from "./refusals";

export interface RelayedStream {
  /** Closes both halves with this code and reason (the tombstone and the expel path). */
  close(code: number, reason: string): void;
  alive(): boolean;
}

export interface PairSpec {
  readonly inMux: LinkMux;
  readonly outMux: LinkMux;
  /** The frame as it must leave: routed fields already updated, `id` still the incoming one. */
  readonly frame: IncomingOpen;
  readonly onGone: () => void;
}

/**
 * One relayed stream: a stream on the incoming link and one on the outgoing link, joined. Each side's data is
 * queued on the other under that link's credit; credit goes back upstream only after the downstream send, so a
 * stream never holds more than one window here. `ready`, `response` and `close` cross as control frames.
 */
export function relayStream({ inMux, outMux, frame, onGone }: PairSpec): RelayedStream {
  const inId = frame.id;
  const outId = outMux.allocateId();
  const isRequest = frame.type === "request";
  let gone = false;
  let sentDown = isRequest ? (frame.bodyBytes ?? 0) === 0 : false;
  let sentUp = false;
  const settle = () => {
    if (gone || !isRequest || !sentDown || !sentUp) return;
    gone = true;
    inMux.removeStream(inId);
    outMux.removeStream(outId);
    onGone();
  };
  const cut = (code: number, reason: string, notify: "in" | "out" | "both") => {
    if (gone) return;
    gone = true;
    inMux.removeStream(inId);
    outMux.removeStream(outId);
    if (notify !== "out") inMux.sendControl({ type: "close", id: inId, code, reason });
    if (notify !== "in") outMux.sendControl({ type: "close", id: outId, code, reason });
    onGone();
  };
  const stalled = () => cut(NO_CREDIT, "no credit", "both");
  const up: LinkStream = newStream(
    inId,
    Date.now(),
    {
      onData(data) {
        enqueue(down, { ...data, id: outId });
        outMux.pump();
      },
      onClose: (code, reason) => cut(code, reason, "out"),
      onStalled: stalled,
    },
    true,
  );
  const down: LinkStream = newStream(
    outId,
    Date.now(),
    {
      onData(data) {
        enqueue(up, { ...data, id: inId });
        inMux.pump();
      },
      onClose: (code, reason) => cut(code, reason, "in"),
      onStalled: stalled,
    },
    isRequest,
  );
  up.onSent = (bytes) => returnCredit(down, outMux, bytes);
  down.onSent = (bytes) => returnCredit(up, inMux, bytes);
  down.onReady = () => inMux.sendControl({ type: "ready", id: inId });
  down.onResponse = (status, headers) => inMux.sendControl({ type: "response", id: inId, status, headers });
  down.onSentEnd = () => {
    sentDown = true;
    settle();
  };
  up.onSentEnd = () => {
    sentUp = true;
    settle();
  };
  up.awaitingInbound = false;
  inMux.addStream(up);
  outMux.addStream(down);
  outMux.sendControl({ ...frame, id: outId });
  return {
    close: (code, reason) => cut(code, reason, "both"),
    alive: () => !gone,
  };
}

/** `owed` on the stream that RECEIVED the bytes: the sender on the other link gets its credit back now. */
function returnCredit(received: LinkStream, mux: LinkMux, bytes: number): void {
  received.owed += bytes;
  mux.returnCredit(received);
}
