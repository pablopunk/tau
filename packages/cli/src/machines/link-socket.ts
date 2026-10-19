import { CHUNK_BYTES, CREDIT_WINDOW_BYTES, chunkBody, type RequestFrame } from "@tau/protocol";
import WebSocket from "ws";
import { type LinkContext, loopbackHeaders, type Stream } from "./link-context";
import { targetOf } from "./link-endpoint";

const MAX_INPUT_BYTES = 64 * 1024;
const NOT_SENDABLE = new Set([1004, 1005, 1006, 1015]);

type OpenFrame = Pick<RequestFrame, "id" | "path" | "query" | "hubDevice">;

interface Held {
  readonly payload: Uint8Array;
  readonly text: boolean;
}

const closeCodeOf = (code: number): number =>
  code >= 1000 && code < 5000 && !NOT_SENDABLE.has(code) ? code : 1011;

/** Relays one hub stream to a loopback WebSocket of this machine's own server (`/api/live`, terminal stream). */
export function startSocketStream(context: LinkContext, frame: OpenFrame, finished: () => void): Stream {
  const { id } = frame;
  const socket = new WebSocket(`ws://127.0.0.1:${context.port}${targetOf(frame.path, frame.query)}`, {
    headers: loopbackHeaders(context, frame.hubDevice),
    maxPayload: CHUNK_BYTES * 4,
  });
  const queued: Held[] = [];
  let open = false;
  let ended = false;

  const end = (code: number, reason: string, tell: boolean) => {
    if (ended) return;
    ended = true;
    if (!tell) {
      context.sender.drop(id);
      return finished();
    }
    const close = { type: "close", id, code: closeCodeOf(code), reason: reason.slice(0, 120) } as const;
    void context.sender.push({ id, end: true, text: false, payload: new Uint8Array(0) }).then((sent) => {
      if (sent) context.sendControl(close);
      context.sender.drop(id);
      finished();
    });
  };

  const credit = (bytes: number) => bytes > 0 && context.sendControl({ type: "credit", id, bytes });

  function deliver({ payload, text }: Held): void {
    const bytes = payload.byteLength;
    if (text) return void socket.send(Buffer.from(payload).toString("utf8"), () => credit(bytes));
    for (let offset = 0; offset < bytes; offset += MAX_INPUT_BYTES) {
      const part = payload.subarray(offset, offset + MAX_INPUT_BYTES);
      socket.send(part, { binary: true }, () => credit(part.byteLength));
    }
  }

  socket.on("open", () => {
    open = true;
    context.sendControl({
      type: "open",
      id,
      path: frame.path,
      query: frame.query,
      hubDevice: frame.hubDevice,
    });
    for (const held of queued.splice(0)) deliver(held);
  });

  socket.on("message", (data, isBinary) => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]);
    if (!isBinary && bytes.byteLength > CHUNK_BYTES) {
      socket.close(1009, "message too big");
      return end(1009, "message too big", true);
    }
    for (const part of chunkBody(id, bytes, !isBinary)) {
      void context.sender.push({ ...part, end: false }).then(relieve);
    }
    if (context.sender.pending(id) >= CREDIT_WINDOW_BYTES) socket.pause();
  });
  const relieve = () => {
    if (context.sender.pending(id) < CREDIT_WINDOW_BYTES / 2) socket.resume();
  };

  socket.on("close", (code, reason) => end(code, reason.toString(), true));
  socket.on("error", () => end(1011, "loopback socket failed", true));

  return {
    onData(payload, _end, text) {
      if (ended) return;
      if (text && payload.byteLength > MAX_INPUT_BYTES) {
        socket.close(1009, "message too big");
        return end(1009, "message too big", true);
      }
      const held = { payload: Uint8Array.from(payload), text };
      if (open) deliver(held);
      else queued.push(held);
    },
    onClose() {
      end(1000, "", false);
      socket.close();
    },
    abort() {
      ended = true;
      context.sender.drop(id);
      socket.terminate();
    },
  };
}
