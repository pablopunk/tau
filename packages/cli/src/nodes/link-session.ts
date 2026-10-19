import {
  decodeDataFrame,
  LINK_OFFLINE_AFTER_MS,
  LINK_PING_INTERVAL_MS,
  type LinkFrame,
  LinkFrameSchema,
  type NodeHello,
} from "@tau/protocol";
import { Value } from "typebox/value";
import type WebSocket from "ws";
import type { LinkContext, Stream } from "./link-context";
import { startRequest } from "./link-request";
import { createLinkSender } from "./link-sender";
import { startSocketStream } from "./link-socket";

export interface SessionOptions {
  readonly port: number;
  readonly token: string;
  readonly hello: NodeHello;
  readonly pingMs?: number;
  readonly idleMs?: number;
  readonly log: (message: string) => void;
}

export interface SessionEnd {
  readonly code: number;
  readonly reason: string;
}

export interface LinkSession {
  /** Resolves once the socket closed and every stream was aborted. */
  readonly ended: Promise<SessionEnd>;
  close(): void;
}

function parseFrame(data: WebSocket.RawData): LinkFrame | undefined {
  try {
    const value: unknown = JSON.parse(data.toString());
    return Value.Check(LinkFrameSchema, value) ? (value as LinkFrame) : undefined;
  } catch {
    return undefined;
  }
}

/** Serves one open link socket: `hello`, pings, `request` and `open` frames, data and credit. */
export function runLinkSession(socket: WebSocket, options: SessionOptions): LinkSession {
  const streams = new Map<number, Stream>();
  const sender = createLinkSender(socket);
  const send = (frame: LinkFrame) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
  };
  const context: LinkContext = {
    port: options.port,
    token: options.token,
    sender,
    sendControl: send,
    log: options.log,
  };
  const forget = (id: number) => () => void streams.delete(id);

  const serve = (frame: LinkFrame) => {
    if (frame.type === "request") streams.set(frame.id, startRequest(context, frame, forget(frame.id)));
    else if (frame.type === "open")
      streams.set(frame.id, startSocketStream(context, frame, forget(frame.id)));
    else if (frame.type === "credit") sender.addCredit(frame.id, frame.bytes);
    else if (frame.type === "close") streams.get(frame.id)?.onClose();
    else if (frame.type === "ping") send({ type: "pong" });
  };
  const logged = (frame: LinkFrame) => {
    if (frame.type === "request" || frame.type === "open") {
      options.log(
        `hub device ${JSON.stringify(frame.hubDevice)}: ${frame.type === "request" ? frame.method : "open"} ${frame.path}`,
      );
    }
  };

  let lastFrameAt = Date.now();
  socket.on("message", (data, isBinary) => {
    lastFrameAt = Date.now();
    if (isBinary) {
      const bytes = Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]);
      const decoded = decodeDataFrame(bytes);
      if (decoded) streams.get(decoded.id)?.onData(decoded.payload, decoded.end, decoded.text);
      return;
    }
    const frame = parseFrame(data);
    if (!frame) return;
    logged(frame);
    serve(frame);
  });

  const ping = setInterval(() => {
    if (Date.now() - lastFrameAt > (options.idleMs ?? LINK_OFFLINE_AFTER_MS)) return socket.terminate();
    send({ type: "ping" });
  }, options.pingMs ?? LINK_PING_INTERVAL_MS);

  const ended = new Promise<SessionEnd>((resolve) => {
    socket.once("close", (code, reason) => {
      clearInterval(ping);
      sender.closeAll();
      for (const stream of streams.values()) stream.abort();
      streams.clear();
      resolve({ code, reason: reason.toString() });
    });
  });
  send({ type: "hello", ...options.hello });
  return { ended, close: () => socket.close(1000, "stopping") };
}
