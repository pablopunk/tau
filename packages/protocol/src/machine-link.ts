import { Type } from "typebox";
import { MachineHelloSchema } from "./machines";
import { API_PREFIX } from "./rest";
import { WS_MAX_PAYLOAD_BYTES } from "./terminal-stream";

/**
 * The machine link: one WebSocket per machine, `GET /api/machines/link`, dialled by the machine.
 * TEXT frames are the control schemas below. BINARY frames carry bodies and stream data:
 * `[4-byte stream id, big endian][1 flag byte][payload of at most CHUNK_BYTES]`.
 * Stream ids are allocated by the hub only. An over-size text frame is refused, never split.
 */
export const MACHINE_LINK_PATH = `${API_PREFIX}/machines/link`;

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
/** The hub closes a link whose `hello.protocolVersion` differs from its own; the machine shows "update required". */
export const LINK_CLOSE_UPDATE_REQUIRED = 4001;

export const FLAG_END = 0x01;
/** The payload is one text WebSocket message (`/live`), not binary. */
export const FLAG_TEXT = 0x02;

const StreamId = Type.Integer({ minimum: 1, maximum: 0xffffffff });

export const HelloFrameSchema = Type.Object({
  type: Type.Literal("hello"),
  ...MachineHelloSchema.properties,
});
export const RequestFrameSchema = Type.Object({
  type: Type.Literal("request"),
  id: StreamId,
  method: Type.String(),
  path: Type.String(),
  query: Type.String(),
  /** A label of the hub device, set as header `x-tau-hub-device` for the machine's log. */
  hubDevice: Type.String({ maxLength: 120 }),
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
  hubDevice: Type.String({ maxLength: 120 }),
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

export const LinkFrameSchema = Type.Union([
  HelloFrameSchema,
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

export interface DataFrame {
  readonly id: number;
  readonly end: boolean;
  readonly text: boolean;
  readonly payload: Uint8Array;
}

export function encodeDataFrame({ id, end, text, payload }: DataFrame): Uint8Array {
  if (payload.byteLength > CHUNK_BYTES) throw new RangeError("A data frame carries at most CHUNK_BYTES");
  const out = new Uint8Array(DATA_HEADER_BYTES + payload.byteLength);
  new DataView(out.buffer).setUint32(0, id);
  out[4] = (end ? FLAG_END : 0) | (text ? FLAG_TEXT : 0);
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
