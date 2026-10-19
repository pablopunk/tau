import { type ClientRequest, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { AppError, CREDIT_WINDOW_BYTES, chunkBody, type RequestFrame, toErrorBody } from "@tau/protocol";
import { sanitiseVia } from "./device-labels";
import { isUnsafeQuery, targetOf } from "./link-frames";
import { EMPTY_END, enqueue, newStream } from "./link-stream";
import { filterProxyPath, filterResponseHeaders } from "./path-filter";
import { loopbackHeaders, type ResponderContext } from "./responder-context";

const FAILED = 1011;
const TOO_BIG = 1009;
const NO_CREDIT = 1013;

function flatten(headers: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) out[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

function errorCodeOf(status: number) {
  if (status === 403) return "unauthorized";
  if (status === 413) return "too_large";
  return status === 400 ? "invalid_request" : "not_found";
}

/** Answers a refused request: the response, then a stream that drains and drops an announced body. */
function refuse(context: ResponderContext, frame: RequestFrame, status: number, reason: string): void {
  const { mux } = context;
  const { id } = frame;
  const announced = frame.bodyBytes ?? 0;
  const body = Buffer.from(JSON.stringify(toErrorBody(new AppError(errorCodeOf(status), reason))));
  let received = 0;
  let sentEnd = false;
  let drained = announced === 0;
  const settle = () => {
    if (sentEnd && drained) mux.removeStream(id);
  };
  const stream = newStream(
    id,
    Date.now(),
    {
      onData(data) {
        received += data.payload.byteLength;
        stream.owed += data.payload.byteLength;
        mux.returnCredit(stream);
        drained = data.end || received >= announced;
        settle();
      },
      onClose: () => mux.removeStream(id),
      onStalled: () => mux.removeStream(id),
    },
    true,
  );
  stream.awaitingInbound = !drained;
  stream.onSentEnd = () => {
    sentEnd = true;
    settle();
  };
  mux.addStream(stream);
  mux.sendControl({ type: "response", id, status, headers: { "content-type": "application/json" } });
  for (const part of chunkBody(id, body)) enqueue(stream, part);
  mux.pump();
}

/** Serves a `request` frame: filter the path, call this server on loopback, stream the answer back under credit. */
export function serveRequest(context: ResponderContext, frame: RequestFrame): void {
  const decision = filterProxyPath(frame.method, frame.path);
  if (!decision.allowed) return void refuse(context, frame, decision.status, decision.reason);
  if (decision.target.kind !== "http") return void refuse(context, frame, 400, "That path is a socket.");
  if (isUnsafeQuery(frame.query)) return void refuse(context, frame, 400, "Bad query string.");
  if ((frame.bodyBytes ?? 0) > decision.target.bodyLimit)
    return void refuse(context, frame, 413, "The request body is too large.");
  startLoopbackCall(context, frame, decision.path);
}

function startLoopbackCall(context: ResponderContext, frame: RequestFrame, path: string): void {
  const { mux } = context;
  const { id } = frame;
  const announced = frame.bodyBytes ?? 0;
  let received = 0;
  let responded = false;
  let sentEnd = false;
  let bodyDone = announced === 0;
  let over = false;
  const settle = () => {
    if ((sentEnd && bodyDone) || over) mux.removeStream(id);
  };
  const req = openRequest(context, frame, path, (res) => {
    responded = true;
    mux.sendControl({
      type: "response",
      id,
      status: res.statusCode ?? 502,
      headers: filterResponseHeaders(flatten(res.headers)),
    });
    pipeResponse(res);
  });
  if (!req) return void refuse(context, frame, 400, "Bad request target.");
  const stream = newStream(
    id,
    Date.now(),
    {
      onData(data) {
        if (over) return;
        received += data.payload.byteLength;
        if (received > announced) return abort(TOO_BIG, "body larger than announced");
        const size = data.payload.byteLength;
        const flushed = () => {
          stream.owed += size;
          mux.returnCredit(stream);
        };
        if (size > 0) req.write(data.payload, flushed);
        if (data.end || received >= announced) {
          req.end();
          bodyDone = true;
          stream.awaitingInbound = false;
          settle();
        }
      },
      onClose() {
        over = true;
        req.destroy();
        settle();
      },
      onStalled: () => abort(NO_CREDIT, "no credit"),
    },
    true,
  );
  stream.awaitingInbound = !bodyDone;
  stream.onSentEnd = () => {
    sentEnd = true;
    settle();
  };
  const abort = (code: number, reason: string) => {
    if (over) return;
    over = true;
    mux.sendControl({ type: "close", id, code, reason });
    req.destroy();
    settle();
  };
  mux.addStream(stream);

  function pipeResponse(res: NodeJS.ReadableStream): void {
    stream.onDrained = () => res.resume();
    res.on("data", (chunk: Buffer) => {
      if (over) return;
      for (const part of chunkBody(id, chunk)) enqueue(stream, { ...part, end: false });
      mux.pump();
      if (stream.pendingBytes >= CREDIT_WINDOW_BYTES) res.pause();
    });
    res.on("end", () => {
      if (over) return;
      enqueue(stream, EMPTY_END(id));
      mux.pump();
    });
    res.on("error", () => abort(FAILED, "response failed"));
  }

  req.on("error", () => {
    if (over) return;
    if (responded) return abort(FAILED, "request failed");
    mux.sendControl({ type: "response", id, status: 502, headers: {} });
    bodyDone = true;
    stream.awaitingInbound = false;
    enqueue(stream, EMPTY_END(id));
    mux.pump();
  });
  if (announced === 0) req.end();
}

function openRequest(
  context: ResponderContext,
  frame: RequestFrame,
  path: string,
  onResponse: (res: import("node:http").IncomingMessage) => void,
): ClientRequest | undefined {
  const announced = frame.bodyBytes ?? 0;
  try {
    return httpRequest(
      {
        host: "127.0.0.1",
        port: context.port,
        method: frame.method,
        path: targetOf(path, frame.query),
        headers: {
          ...loopbackHeaders(context, sanitiseVia(frame.via)),
          ...(frame.contentType !== undefined && { "content-type": frame.contentType }),
          ...(announced > 0 && { "content-length": String(announced) }),
        },
      },
      onResponse,
    );
  } catch {
    return undefined;
  }
}
