import { type ClientRequest, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { chunkBody, type RequestFrame } from "@tau/protocol";
import { type LinkContext, loopbackHeaders, type Stream } from "./link-context";
import { targetOf } from "./link-endpoint";

function flatten(headers: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) out[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

function requestHeaders(context: LinkContext, frame: RequestFrame): Record<string, string> {
  return {
    ...loopbackHeaders(context, frame.hubDevice),
    ...(frame.contentType !== undefined && { "content-type": frame.contentType }),
    ...(frame.bodyBytes !== undefined &&
      frame.bodyBytes > 0 && { "content-length": String(frame.bodyBytes) }),
  };
}

/** Calls this node's own server on loopback and streams the answer back as `response` + data frames. */
export function startRequest(context: LinkContext, frame: RequestFrame, finished: () => void): Stream {
  const { id } = frame;
  const hasBody = (frame.bodyBytes ?? 0) > 0;
  let responded = false;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    finished();
  };

  const req: ClientRequest = httpRequest(
    {
      host: "127.0.0.1",
      port: context.port,
      method: frame.method,
      path: targetOf(frame.path, frame.query),
      headers: requestHeaders(context, frame),
    },
    (res) => {
      responded = true;
      context.sendControl({
        type: "response",
        id,
        status: res.statusCode ?? 502,
        headers: flatten(res.headers),
      });
      void pipeResponse(res);
    },
  );

  async function pipeResponse(res: AsyncIterable<Buffer>): Promise<void> {
    try {
      for await (const chunk of res) {
        for (const part of chunkBody(id, chunk)) {
          if (!(await context.sender.push({ ...part, end: false }))) {
            req.destroy();
            return;
          }
        }
      }
      await context.sender.push({ id, end: true, text: false, payload: new Uint8Array(0) });
    } catch {
      context.sendControl({ type: "close", id, code: 1011, reason: "response failed" });
    } finally {
      context.sender.drop(id);
      finish();
    }
  }

  req.on("error", () => {
    if (done) return;
    if (!responded) {
      context.sendControl({ type: "response", id, status: 502, headers: {} });
      void context.sender.push({ id, end: true, text: false, payload: new Uint8Array(0) }).then(() => {
        context.sender.drop(id);
        finish();
      });
    } else {
      context.sendControl({ type: "close", id, code: 1011, reason: "request failed" });
      context.sender.drop(id);
      finish();
    }
  });

  if (!hasBody) req.end();

  return {
    onData(payload, end) {
      if (!hasBody || req.writableEnded) return;
      const sent = payload.byteLength;
      const flushed = () => sent > 0 && context.sendControl({ type: "credit", id, bytes: sent });
      if (sent > 0) req.write(payload, flushed);
      if (end) req.end();
    },
    onClose() {
      req.destroy();
      context.sender.drop(id);
      finish();
    },
    abort() {
      req.destroy();
      context.sender.drop(id);
    },
  };
}
