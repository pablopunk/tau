import { Type } from "typebox";

/** A group has at most this many live nodes; a routed frame starts with this `ttl` (diameter is at most 15). */
export const GROUP_NODE_CAP = 16;
export const ROUTE_TTL_START = 16;
export const TRAIL_MAX = 16;
/** Announce cadence: on any change (coalesced, trailing edge, one per 2 s per origin) and every 15 s. */
export const ANNOUNCE_COALESCE_MS = 2_000;
export const ANNOUNCE_INTERVAL_MS = 15_000;
/** An origin with no announce for this long is expired (the fallback status). */
export const ANNOUNCE_EXPIRY_MS = 45_000;
/** A routed request header older or newer than this is refused ("clock skew with <node>"). */
export const REQUEST_WINDOW_MS = 120_000;
export const EXPEL_SYNC_TIMEOUT_MS = 10_000;
export const EXPEL_LIST_CAP = 256;
export const EXPEL_TOMBSTONE_EVICT_MS = 30 * 24 * 60 * 60 * 1000;
/** Per `by`: live expels kept, and expels a node may create per minute. */
export const EXPEL_QUOTA_PER_KEY = 32;
export const EXPEL_CREATE_PER_MINUTE = 5;
export const NONCE_CACHE_CAP = 4096;

/** `hello.capabilities` entries of Step 2. */
export const CAPABILITY_ANNOUNCE = "announce";
export const CAPABILITY_RELAY = "relay";
export const STEP2_CAPABILITIES: readonly string[] = [CAPABILITY_ANNOUNCE, CAPABILITY_RELAY];

const NodeIdField = Type.String({ minLength: 1, maxLength: 64 });
const KeyField = Type.String({ minLength: 1, maxLength: 64 });
const SigField = Type.String({ minLength: 1, maxLength: 128 });

/**
 * Optional fields of a routed `request` or `open`. Absent on a direct (one-hop) frame. `payload` is signed
 * verbatim (`tau-req-v1|…`, see `identity/request-header.ts`); `trail` and `ttl` are outside the signature
 * (relays append and decrement them).
 */
export const RoutedFieldsSchema = Type.Object({
  dest: Type.Optional(NodeIdField),
  origin: Type.Optional(NodeIdField),
  originPublicKey: Type.Optional(KeyField),
  trail: Type.Optional(Type.Array(NodeIdField, { maxItems: TRAIL_MAX })),
  ttl: Type.Optional(Type.Integer({ minimum: 0, maximum: ROUTE_TTL_START })),
  payload: Type.Optional(Type.String({ maxLength: 4096 })),
  originSig: Type.Optional(SigField),
});
export type RoutedFields = Type.Static<typeof RoutedFieldsSchema>;

/** `payload` is signed verbatim (`tau-announce-v1|…`); `ttl` is outside it. */
export const AnnounceFrameSchema = Type.Object({
  type: Type.Literal("announce"),
  payload: Type.String({ maxLength: 4096 }),
  sig: SigField,
  ttl: Type.Integer({ minimum: 0, maximum: ROUTE_TTL_START }),
});
export type AnnounceFrame = Type.Static<typeof AnnounceFrameSchema>;

/** `payload` is `tau-expel-v1|<target>|<by>|<time>`; `byPublicKey` lets any node verify it. */
export const ExpelFrameSchema = Type.Object({
  type: Type.Literal("expel"),
  payload: Type.String({ maxLength: 512 }),
  byPublicKey: KeyField,
  sig: SigField,
});
export type ExpelFrame = Type.Static<typeof ExpelFrameSchema>;

/** `payload` is `tau-ack-v1|<target>|<node>|<time>`, signed by `node`. */
export const ExpelAckFrameSchema = Type.Object({
  type: Type.Literal("expel-ack"),
  payload: Type.String({ maxLength: 512 }),
  nodePublicKey: KeyField,
  sig: SigField,
});
export type ExpelAckFrame = Type.Static<typeof ExpelAckFrameSchema>;

/**
 * Sent on every link-up before anything else of Step 2: the sender's FULL expel set (at most 256, about 77 KB).
 * The receiver accepts no announce or route from that neighbour until it has arrived (10 s, else "unsynced").
 */
export const ExpelSyncFrameSchema = Type.Object({
  type: Type.Literal("expel-sync"),
  expels: Type.Array(ExpelFrameSchema, { maxItems: EXPEL_LIST_CAP }),
});
export type ExpelSyncFrame = Type.Static<typeof ExpelSyncFrameSchema>;
