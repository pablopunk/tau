import { AppError, chunkBody } from "@tau/protocol";
import type { GatewayRequest, GatewayResponse } from "./gateway";
import type { LinkSession } from "./link-session";
import { enqueue, newStream } from "./link-stream";

const MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
const OFFLINE = "This node is offline.";

/** One proxied HTTP call over a link: body out under the node's credit, response in under ours. */
export function proxyRequest(session: LinkSession, request: GatewayRequest): Promise<GatewayResponse> {
  return new Promise((resolve, reject) => {
    const id = session.allocateId();
    const chunks: Buffer[] = [];
    let received = 0;
    let head: { status: number; headers: Record<string, string> } | undefined;
    const finish = (error?: AppError) => {
      session.removeStream(id);
      if (error) reject(error);
    };
    const stream = newStream(
      id,
      Date.now(),
      {
        onData(frame) {
          received += frame.payload.byteLength;
          if (received > MAX_RESPONSE_BYTES) {
            session.sendControl({ type: "close", id, code: 1009, reason: "response too large" });
            return finish(new AppError("too_large", "The node's response is too large."));
          }
          chunks.push(Buffer.from(frame.payload));
          stream.owed += frame.payload.byteLength;
          if (!frame.end) return session.returnCredit(stream);
          session.removeStream(id);
          if (head) resolve({ ...head, body: Buffer.concat(chunks) });
          else reject(new AppError("internal", "The node answered without a response."));
        },
        onClose: (_code, reason) =>
          finish(new AppError(reason === "node went away" ? "not_found" : "internal", OFFLINE)),
        onStalled() {
          session.sendControl({ type: "close", id, code: 1013, reason: "no credit" });
          finish(new AppError("not_found", "The node stopped answering."));
        },
      },
      true,
    );
    stream.onResponse = (status, headers) => {
      head = { status, headers };
    };
    const body = request.body && request.body.length > 0 ? request.body : undefined;
    session.addStream(stream);
    session.sendControl({
      type: "request",
      id,
      method: request.method,
      path: request.path,
      query: request.query,
      via: request.hubDevice.slice(0, 120),
      ...(request.contentType ? { contentType: request.contentType } : {}),
      ...(body ? { bodyBytes: body.length } : {}),
    });
    if (body) for (const frame of chunkBody(id, body)) enqueue(stream, frame);
    session.pump();
  });
}
