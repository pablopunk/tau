import { AppError, chunkBody, type RoutedFields } from "@tau/protocol";
import type { GatewayRequest, GatewayResponse } from "./gateway";
import type { LinkMux } from "./link-mux";
import { enqueue, newStream } from "./link-stream";
import { routedRefusal } from "./relay/refusals";

const MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
const OFFLINE = "This node is offline.";
const WENT_AWAY = "node went away";
const DONE = 1000;
const NO_CREDIT = 1013;
const TOO_LARGE = 1009;

/** One proxied HTTP call over a link: body out under the peer's credit, response in under ours. */
export function requestOverLink(
  mux: LinkMux,
  request: GatewayRequest,
  routed?: RoutedFields,
): Promise<GatewayResponse> {
  return new Promise((resolve, reject) => {
    const id = mux.allocateId();
    const chunks: Buffer[] = [];
    let received = 0;
    let head: { status: number; headers: Record<string, string> } | undefined;
    const finish = (error?: AppError) => {
      const unfinishedBody = (mux.streams.get(id)?.pending.length ?? 0) > 0;
      mux.removeStream(id);
      if (unfinishedBody) mux.sendControl({ type: "close", id, code: DONE, reason: "answered" });
      if (error) reject(error);
    };
    const stream = newStream(
      id,
      Date.now(),
      {
        onData(frame) {
          received += frame.payload.byteLength;
          if (received > MAX_RESPONSE_BYTES) {
            mux.sendControl({ type: "close", id, code: TOO_LARGE, reason: "response too large" });
            mux.removeStream(id);
            return reject(new AppError("too_large", "The node's response is too large."));
          }
          chunks.push(Buffer.from(frame.payload));
          stream.owed += frame.payload.byteLength;
          if (!frame.end) return mux.returnCredit(stream);
          finish();
          if (head) resolve({ ...head, body: Buffer.concat(chunks) });
          else reject(new AppError("internal", "The node answered without a response."));
        },
        onClose: (_code, reason) =>
          finish(
            routedRefusal(reason) ?? new AppError(reason === WENT_AWAY ? "not_found" : "internal", OFFLINE),
          ),
        onStalled() {
          mux.sendControl({ type: "close", id, code: NO_CREDIT, reason: "no credit" });
          mux.removeStream(id);
          reject(new AppError("not_found", "The node stopped answering."));
        },
      },
      true,
    );
    stream.onResponse = (status, headers) => {
      head = { status, headers };
    };
    const body = request.body && request.body.length > 0 ? request.body : undefined;
    mux.addStream(stream);
    mux.sendControl({
      type: "request",
      id,
      method: request.method,
      path: request.path,
      query: request.query,
      via: request.via,
      ...routed,
      ...(request.contentType ? { contentType: request.contentType } : {}),
      ...(body ? { bodyBytes: body.length } : {}),
    });
    if (body) for (const frame of chunkBody(id, body)) enqueue(stream, frame);
    mux.pump();
  });
}
