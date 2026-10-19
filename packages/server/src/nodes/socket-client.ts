import { CHUNK_BYTES, CREDIT_WINDOW_BYTES, LINK_CLOSE_NO_CREDIT } from "@tau/protocol";
import type { WebSocket } from "ws";
import type { GatewayStreamRequest } from "./gateway";
import { clipReason, wireCloseCode } from "./link-frames";
import type { LinkMux } from "./link-mux";
import { enqueue, newStream } from "./link-stream";

const GOING_AWAY = 1001;

/** Pipes a browser socket to a stream on the remote node. Browser frames queue until the node sends `ready`. */
export function pipeSocketOverLink(mux: LinkMux, request: GatewayStreamRequest, socket: WebSocket): void {
  const id = mux.allocateId();
  let remoteClosed = false;
  const closeBrowser = (code: number, reason: string) => {
    if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING)
      socket.close(wireCloseCode(code), clipReason(reason));
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
          mux.returnCredit(stream);
        });
      },
      onClose(code, reason) {
        remoteClosed = true;
        mux.removeStream(id);
        closeBrowser(code === GOING_AWAY ? LINK_CLOSE_NO_CREDIT : code, reason);
      },
      onStalled() {
        mux.sendControl({ type: "close", id, code: LINK_CLOSE_NO_CREDIT, reason: "no credit" });
        mux.removeStream(id);
        closeBrowser(LINK_CLOSE_NO_CREDIT, "stalled");
      },
    },
    false,
  );
  stream.onDrained = () => {
    if (typeof socket.resume === "function") socket.resume();
  };
  mux.addStream(stream);
  socket.on("message", (data, isBinary) => {
    if (socket.readyState !== socket.OPEN) return;
    const payload = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
    if (payload.byteLength > CHUNK_BYTES) return;
    enqueue(stream, { id, end: false, text: !isBinary, payload });
    if (stream.pendingBytes >= CREDIT_WINDOW_BYTES && typeof socket.pause === "function") socket.pause();
    mux.pump();
  });
  socket.on("close", (code, reason) => {
    if (remoteClosed) return;
    remoteClosed = true;
    mux.removeStream(id);
    mux.sendControl({ type: "close", id, code: wireCloseCode(code), reason: clipReason(reason.toString()) });
  });
  socket.on("error", () => undefined);
  mux.sendControl({ type: "open", id, path: request.path, query: request.query, via: request.via });
}
