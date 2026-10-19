import { CHUNK_BYTES, CREDIT_WINDOW_BYTES, LINK_CLOSE_NO_CREDIT } from "@tau/protocol";
import type { WebSocket } from "ws";
import type { GatewayStreamRequest } from "./gateway";
import type { LinkSession } from "./link-session";
import { enqueue, newStream } from "./link-stream";

const GOING_AWAY = 1001;
const INTERNAL = 1011;

/** Close codes `ws` accepts on the wire; anything else (1005, 1006, 1015, junk) becomes 1011. */
export function wireCloseCode(code: number): number {
  const valid =
    (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code <= 4999);
  return valid ? code : INTERNAL;
}

function clip(reason: string): string {
  return Buffer.from(reason)
    .subarray(0, 123)
    .toString("utf8")
    .replace(/\uFFFD+$/, "");
}

/** Pipes a browser socket to a stream on the node. Browser frames queue until the node confirms `open`. */
export function pipeSocket(session: LinkSession, request: GatewayStreamRequest, socket: WebSocket): void {
  const id = session.allocateId();
  let nodeClosed = false;
  const closeBrowser = (code: number, reason: string) => {
    if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING)
      socket.close(wireCloseCode(code), clip(reason));
  };
  const stream = newStream(
    id,
    Date.now(),
    {
      onData(frame) {
        if (socket.readyState !== socket.OPEN) return;
        const size = frame.payload.byteLength;
        if (stream.inFlight === 0) stream.progressAt = Date.now();
        stream.inFlight += size;
        socket.send(Buffer.from(frame.payload), { binary: !frame.text }, () => {
          stream.inFlight -= size;
          stream.owed += size;
          stream.progressAt = Date.now();
          session.returnCredit(stream);
        });
      },
      onClose(code, reason) {
        nodeClosed = true;
        session.removeStream(id);
        closeBrowser(code === GOING_AWAY ? LINK_CLOSE_NO_CREDIT : code, reason);
      },
      onStalled() {
        session.sendControl({ type: "close", id, code: LINK_CLOSE_NO_CREDIT, reason: "no credit" });
        session.removeStream(id);
        closeBrowser(LINK_CLOSE_NO_CREDIT, "stalled");
      },
    },
    false,
  );
  stream.onDrained = () => {
    if (typeof socket.resume === "function") socket.resume();
  };
  session.addStream(stream);
  socket.on("message", (data, isBinary) => {
    if (socket.readyState !== socket.OPEN) return;
    const payload = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
    if (payload.byteLength > CHUNK_BYTES) return;
    enqueue(stream, { id, end: false, text: !isBinary, payload });
    if (stream.pendingBytes >= CREDIT_WINDOW_BYTES && typeof socket.pause === "function") socket.pause();
    session.pump();
  });
  socket.on("close", (code, reason) => {
    if (nodeClosed) return;
    nodeClosed = true;
    session.removeStream(id);
    session.sendControl({ type: "close", id, code: wireCloseCode(code), reason: clip(reason.toString()) });
  });
  socket.on("error", () => undefined);
  session.sendControl({
    type: "open",
    id,
    path: request.path,
    query: request.query,
    hubDevice: request.hubDevice.slice(0, 120),
  });
}
