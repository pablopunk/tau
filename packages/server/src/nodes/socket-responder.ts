import { CHUNK_BYTES, CREDIT_WINDOW_BYTES, chunkBody, type DataFrame, type LinkFrame } from "@tau/protocol";
import WebSocket from "ws";
import { sanitiseVia } from "./device-labels";
import { isUnsafeQuery, targetOf, wireCloseCode } from "./link-frames";
import { EMPTY_END, enqueue, newStream } from "./link-stream";
import { filterProxyPath } from "./path-filter";
import { loopbackHeaders, type ResponderContext } from "./responder-context";

const MAX_INPUT_BYTES = 64 * 1024;
const POLICY = 1008;
const TOO_BIG = 1009;
const FAILED = 1011;
const NO_CREDIT = 1013;

type OpenFrame = Extract<LinkFrame, { type: "open" }>;

/** Serves an `open` frame: only `/api/live` and the terminal stream, relayed to a loopback socket of this server. */
export function serveStream(context: ResponderContext, frame: OpenFrame): void {
  const { mux } = context;
  const { id } = frame;
  const decision = filterProxyPath("GET", frame.path);
  const wanted = decision.allowed && decision.target.kind !== "http";
  if (!wanted || isUnsafeQuery(frame.query)) {
    mux.sendControl({ type: "close", id, code: POLICY, reason: "path refused" });
    return;
  }
  relay(context, frame, decision.allowed ? decision.path : frame.path);
}

function relay(context: ResponderContext, frame: OpenFrame, path: string): void {
  const { mux } = context;
  const { id } = frame;
  const loopback = new WebSocket(`ws://127.0.0.1:${context.port}${targetOf(path, frame.query)}`, {
    headers: loopbackHeaders(context, sanitiseVia(frame.via)),
    maxPayload: CHUNK_BYTES * 4,
  });
  const queued: DataFrame[] = [];
  let open = false;
  let ended = false;

  const finish = (code: number, reason: string) => {
    if (ended) return;
    ended = true;
    stream.onSentEnd = () => {
      mux.sendControl({ type: "close", id, code: wireCloseCode(code), reason: reason.slice(0, 120) });
      mux.removeStream(id);
    };
    enqueue(stream, EMPTY_END(id));
    mux.pump();
  };
  const abandon = (code?: number, reason?: string) => {
    if (code !== undefined) mux.sendControl({ type: "close", id, code, reason: reason ?? "" });
    ended = true;
    mux.removeStream(id);
    loopback.terminate();
  };
  const stream = newStream(
    id,
    Date.now(),
    {
      onData(data) {
        if (ended) return;
        if (data.text && data.payload.byteLength > MAX_INPUT_BYTES) {
          loopback.close(TOO_BIG, "message too big");
          return finish(TOO_BIG, "message too big");
        }
        if (open) deliver(data);
        else queued.push(data);
      },
      onClose() {
        ended = true;
        mux.removeStream(id);
        loopback.close();
      },
      onStalled: () => abandon(NO_CREDIT, "no credit"),
    },
    true,
  );
  stream.onDrained = () => loopback.resume();
  mux.addStream(stream);

  const credit = (bytes: number) => {
    stream.owed += bytes;
    stream.progressAt = Date.now();
    mux.returnCredit(stream);
  };
  function deliver({ payload, text }: DataFrame): void {
    const bytes = payload.byteLength;
    if (text) return void loopback.send(Buffer.from(payload).toString("utf8"), () => credit(bytes));
    for (let offset = 0; offset < bytes; offset += MAX_INPUT_BYTES) {
      const part = payload.subarray(offset, offset + MAX_INPUT_BYTES);
      loopback.send(part, { binary: true }, () => credit(part.byteLength));
    }
  }

  loopback.on("open", () => {
    open = true;
    mux.sendControl({ type: "ready", id });
    for (const held of queued.splice(0)) deliver(held);
  });
  loopback.on("message", (data, isBinary) => {
    if (ended) return;
    const bytes = Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]);
    if (!isBinary && bytes.byteLength > CHUNK_BYTES) {
      loopback.close(TOO_BIG, "message too big");
      return finish(TOO_BIG, "message too big");
    }
    for (const part of chunkBody(id, bytes, !isBinary)) enqueue(stream, { ...part, end: false });
    mux.pump();
    if (stream.pendingBytes >= CREDIT_WINDOW_BYTES) loopback.pause();
  });
  loopback.on("close", (code, reason) => finish(code, reason.toString()));
  loopback.on("error", () =>
    open ? finish(FAILED, "loopback socket failed") : abandon(FAILED, "loopback refused"),
  );
}
