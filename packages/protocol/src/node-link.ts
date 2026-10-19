import { Type } from "typebox";
import { NodeHelloSchema } from "./nodes";
import { API_PREFIX } from "./rest";
import { WS_MAX_PAYLOAD_BYTES } from "./terminal-stream";

/**
 * The node link: one WebSocket between two nodes, `GET /api/nodes/link`, dialled by either of them.
 * TEXT frames are the control schemas below. BINARY frames carry bodies and stream data:
 * `[4-byte stream id, big endian][1 flag byte][payload of at most CHUNK_BYTES]`.
 * The dialler allocates ODD stream ids, the acceptor EVEN ids. A peer-initiated `request` or `open`
 * with the wrong parity, or with an id in use, closes the link (1008). An over-size text frame is refused, never split.
 */
export const NODE_LINK_PATH = `${API_PREFIX}/nodes/link`;
/** The 0.1.x path: accepted by the guard so an old dialler gets a clean 4001 ("Update tau"), never a 401. */
export const NODE_LINK_LEGACY_PATH = `${API_PREFIX}/machines/link`;

export type LinkRole = "dialler" | "acceptor";
/** Stream ids a role allocates: odd for the dialler, even for the acceptor. */
export const firstStreamId = (role: LinkRole): number => (role === "dialler" ? 1 : 2);
export const STREAM_ID_STEP = 2;
/** `true` when `id` is a legal id for a stream that the PEER of `receiver` initiates. */
export const isPeerStreamId = (receiver: LinkRole, id: number): boolean =>
  id >= 1 && id <= 0xffffffff && (id % 2 === 1) === (receiver === "acceptor");

export const CHUNK_BYTES = 256 * 1024;
export const DATA_HEADER_BYTES = 5;
/** The shared WebSocket server's `maxPayload`: it must exceed a chunk plus its header. */
export const LINK_MAX_PAYLOAD_BYTES = WS_MAX_PAYLOAD_BYTES;
/** Credit window per stream: the most a sender may have in flight. */
export const CREDIT_WINDOW_BYTES = 1024 * 1024;
export const LINK_PING_INTERVAL_MS = 15_000;
export const LINK_OFFLINE_AFTER_MS = 45_000;
export const LINK_NO_CREDIT_CLOSE_MS = 60_000;
export const LINK_CLOSE_NO_CREDIT = 1013;
/** Intended close of a replaced link (a reconnect after sleep); the dialler retries. */
export const LINK_CLOSE_GOING_AWAY = 1001;
/** A bad frame, a failed handshake, a wrong stream id. */
export const LINK_CLOSE_POLICY = 1008;
/** The other node has another `linkProtocol` (or a 0.1.x dialler): "update required". Not retried. */
export const LINK_CLOSE_UPDATE_REQUIRED = 4001;
/** A link to oneself or a duplicate link to the same node. Not retried. */
export const LINK_CLOSE_DUPLICATE = 4002;
/** Removed from the group (Step 2 expulsion). Not retried. */
export const LINK_CLOSE_REMOVED = 4003;
/** The nonce is 16 random bytes, base64url without padding. */
export const NONCE_BYTES = 16;
export const PROOF_DOMAIN = "tau-proof-v1";

export const FLAG_END = 0x01;
/** The payload is one text WebSocket message (`/live`), not binary. */
export const FLAG_TEXT = 0x02;
/** More parts of the same WebSocket message follow: the receiver joins them before it delivers the message. */
export const FLAG_MORE = 0x04;
/** The largest WebSocket message a link stream carries in parts (a long thread's `/live` snapshot). */
export const LINK_MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

const StreamId = Type.Integer({ minimum: 1, maximum: 0xffffffff });

export const HelloFrameSchema = Type.Object({
  type: Type.Literal("hello"),
  ...NodeHelloSchema.properties,
});
/** `payload` is signed verbatim: `tau-proof-v1|<peer nonce>|<own nodeId>|<peer nodeId>`. */
export const ProofFrameSchema = Type.Object({
  type: Type.Literal("proof"),
  payload: Type.String({ maxLength: 512 }),
  sig: Type.String({ maxLength: 128 }),
});
/** Acknowledges a stream the peer opened (`open`); a data frame no longer implies ready. */
export const ReadyFrameSchema = Type.Object({ type: Type.Literal("ready"), id: StreamId });
/** Sent before an intended close (disconnect, revoke, expel): the other side does not retry. */
export const ByeFrameSchema = Type.Object({
  type: Type.Literal("bye"),
  reason: Type.String({ maxLength: 120 }),
});
export const RequestFrameSchema = Type.Object({
  type: Type.Literal("request"),
  id: StreamId,
  method: Type.String(),
  path: Type.String(),
  query: Type.String(),
  /** A label of whoever acted, set as header `x-tau-via` on the loopback call for the node's log. */
  via: Type.String({ maxLength: 120 }),
  contentType: Type.Optional(Type.String()),
  /** Body bytes that follow as data frames; absent for no body. */
  bodyBytes: Type.Optional(Type.Integer({ minimum: 0 })),
});
export const ResponseFrameSchema = Type.Object({
  type: Type.Literal("response"),
  id: StreamId,
  status: Type.Integer({ minimum: 100, maximum: 599 }),
  headers: Type.Record(Type.String(), Type.String()),
});
export const OpenFrameSchema = Type.Object({
  type: Type.Literal("open"),
  id: StreamId,
  path: Type.String(),
  query: Type.String(),
  via: Type.String({ maxLength: 120 }),
});
export const CloseFrameSchema = Type.Object({
  type: Type.Literal("close"),
  id: StreamId,
  code: Type.Integer(),
  reason: Type.String({ maxLength: 123 }),
});
export const CreditFrameSchema = Type.Object({
  type: Type.Literal("credit"),
  id: StreamId,
  bytes: Type.Integer({ minimum: 1 }),
});
export const PingFrameSchema = Type.Object({ type: Type.Literal("ping") });
export const PongFrameSchema = Type.Object({ type: Type.Literal("pong") });

/** The frames whose schemas decide whether two nodes may link (`linkProtocol`), plus the binary header. */
export const BASE_FRAME_SCHEMAS = {
  hello: HelloFrameSchema,
  proof: ProofFrameSchema,
  ready: ReadyFrameSchema,
  bye: ByeFrameSchema,
  request: RequestFrameSchema,
  response: ResponseFrameSchema,
  open: OpenFrameSchema,
  close: CloseFrameSchema,
  credit: CreditFrameSchema,
} as const;

export const LinkFrameSchema = Type.Union([
  HelloFrameSchema,
  ProofFrameSchema,
  ReadyFrameSchema,
  ByeFrameSchema,
  RequestFrameSchema,
  ResponseFrameSchema,
  OpenFrameSchema,
  CloseFrameSchema,
  CreditFrameSchema,
  PingFrameSchema,
  PongFrameSchema,
]);
export type LinkFrame = Type.Static<typeof LinkFrameSchema>;
export type RequestFrame = Type.Static<typeof RequestFrameSchema>;
export type HelloFrame = Type.Static<typeof HelloFrameSchema>;
export type ProofFrame = Type.Static<typeof ProofFrameSchema>;

export interface DataFrame {
  readonly id: number;
  readonly end: boolean;
  readonly text: boolean;
  readonly payload: Uint8Array;
  /** Another part of this message follows. Absent means false. */
  readonly more?: boolean;
}

export function encodeDataFrame({ id, end, text, payload, more }: DataFrame): Uint8Array {
  if (payload.byteLength > CHUNK_BYTES) throw new RangeError("A data frame carries at most CHUNK_BYTES");
  const out = new Uint8Array(DATA_HEADER_BYTES + payload.byteLength);
  new DataView(out.buffer).setUint32(0, id);
  out[4] = (end ? FLAG_END : 0) | (text ? FLAG_TEXT : 0) | (more ? FLAG_MORE : 0);
  out.set(payload, DATA_HEADER_BYTES);
  return out;
}

/** `undefined` for a frame shorter than the header. */
export function decodeDataFrame(bytes: Uint8Array): DataFrame | undefined {
  if (bytes.byteLength < DATA_HEADER_BYTES) return undefined;
  const flags = bytes[4] ?? 0;
  return {
    id: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0),
    end: (flags & FLAG_END) !== 0,
    text: (flags & FLAG_TEXT) !== 0,
    more: (flags & FLAG_MORE) !== 0,
    payload: bytes.subarray(DATA_HEADER_BYTES),
  };
}

/** Splits a body into chunks; an empty body is one empty chunk with `end`. */
export function* chunkBody(id: number, body: Uint8Array, text = false): Generator<DataFrame> {
  let offset = 0;
  do {
    const payload = body.subarray(offset, offset + CHUNK_BYTES);
    offset += payload.byteLength;
    yield { id, end: offset >= body.byteLength, text, payload };
  } while (offset < body.byteLength);
}

/** Splits one WebSocket message into parts: every part but the last has `more`; none ends the stream. */
export function* chunkMessage(id: number, message: Uint8Array, text: boolean): Generator<DataFrame> {
  for (const part of chunkBody(id, message, text)) yield { ...part, end: false, more: !part.end };
}
