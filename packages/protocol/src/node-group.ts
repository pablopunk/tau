import { Type } from "typebox";
import type { AnnounceFrame, ExpelAckFrame, ExpelFrame } from "./node-link-routing";
import { NodeSchema } from "./nodes";
import type { Route } from "./routing";

/**
 * A node of the group as THIS node sees it: a neighbour (`direct`, `hops` 1, with `links`) or a routed node
 * (`hops` above 1, `links` empty, `via` names the next hop). A node that stopped announcing but is not
 * expelled is a `ghost` (offline, not counted toward the cap of 16).
 */
export const DirectoryNodeSchema = Type.Object({
  ...NodeSchema.properties,
  direct: Type.Boolean(),
  hops: Type.Integer({ minimum: 1, maximum: 16 }),
  /** `nodeId` of the next hop; `null` when the node is not reachable right now. */
  nextHop: Type.Union([Type.String(), Type.Null()]),
  /** Display name of the next hop, shown as text: "via B". `null` for a neighbour. */
  via: Type.Union([Type.String(), Type.Null()]),
  /** Last measured clock distance to this node in ms (positive: it is ahead); `null` when never measured. */
  skewMs: Type.Union([Type.Number(), Type.Null()]),
  ghost: Type.Boolean(),
  /** A neighbour whose expel set has not arrived (10 s): no routes through it. */
  unsynced: Type.Boolean(),
});
export type DirectoryNode = Type.Static<typeof DirectoryNodeSchema>;

/** Who confirmed an expel (`expel-ack`). `pending` is "B has not confirmed". */
export const ExpulsionSchema = Type.Object({
  target: Type.String(),
  targetName: Type.Union([Type.String(), Type.Null()]),
  by: Type.String(),
  byName: Type.Union([Type.String(), Type.Null()]),
  at: Type.Number(),
  confirmations: Type.Array(Type.Object({ node: Type.String(), name: Type.String(), at: Type.Number() })),
  pending: Type.Array(Type.Object({ node: Type.String(), name: Type.String() })),
});
export type Expulsion = Type.Static<typeof ExpulsionSchema>;

/** The typed confirmation: the target's exact current name or its `nodeId`. */
export const RemoveNodeBodySchema = Type.Object({ confirm: Type.String({ minLength: 1, maxLength: 120 }) });
export type RemoveNodeBody = Type.Static<typeof RemoveNodeBodySchema>;

/** Set on `NodeSelf` after a verified expel against this node's id: "this node was removed, reset its identity". */
export const NodeRemovalSchema = Type.Object({ by: Type.String(), at: Type.Number() });
export type NodeRemoval = Type.Static<typeof NodeRemovalSchema>;

export type AnnounceRefusalReason =
  | "bad-payload"
  | "bad-key"
  | "key-mismatch"
  | "bad-signature"
  | "too-many-neighbours"
  | "stale"
  | "tombstoned"
  | "about-self"
  | "capability"
  | "cap-reached"
  | "unsynced"
  | "not-linked";

/** What the server does next with an announce it handed to `NodeGroup.acceptAnnounce`. */
export interface AnnounceOutcome {
  readonly accepted: boolean;
  /** Re-flood to every link except the source, with this `ttl` (`undefined`: do not). */
  readonly forwardTtl?: number;
  readonly reason?: AnnounceRefusalReason;
}

export interface ExpelOutcome {
  readonly fresh: boolean;
  readonly target?: string;
  /** Re-flood to every link except the source (including toward the target) BEFORE cutting. */
  readonly reflood: boolean;
  /** Our signed confirmation to flood back (only for a fresh, valid expel). */
  readonly ack?: ExpelAckFrame;
  /** The expel names THIS node: quarantine ("this node was removed"). */
  readonly selfExpelled: boolean;
  readonly reason?: "bad-payload" | "bad-key" | "self-expel" | "bad-signature" | "rate-limited" | "capacity";
}

export interface AckOutcome {
  readonly fresh: boolean;
  readonly reflood: boolean;
}

export type TombstoneListener = (target: string) => void;

/**
 * The seam between the link layer (server, owner F) and the directory (core, owner E). The server owns
 * sockets and frames; core owns state, signatures and decisions. Every method may reject `internal`
 * ("Not implemented") until owner E fills `core/src/nodes/directory`.
 */
export interface NodeGroup {
  /** Our own signed announce, counter incremented; call on link-up, on a change, every 15 s. */
  localAnnounce(): Promise<AnnounceFrame>;
  /** A neighbour's link passed the handshake and listed `announce`: it counts as an edge once its expel set is synced. */
  linkUp(peerId: string): void;
  /** The link closed: its edge is removed at once; the caller re-announces. */
  linkDown(peerId: string): void;
  acceptAnnounce(frame: AnnounceFrame, fromPeerId: string): Promise<AnnounceOutcome>;
  acceptExpel(frame: ExpelFrame, fromPeerId: string | undefined): Promise<ExpelOutcome>;
  acceptAck(frame: ExpelAckFrame, fromPeerId: string): Promise<AckOutcome>;
  /** Our full expel set: sent on every link-up before any announce. */
  expelSet(): Promise<ExpelFrame[]>;
  /** The neighbour's full set arrived: each is processed as `acceptExpel`; the neighbour is now synced. */
  acceptExpelSet(frames: readonly ExpelFrame[], fromPeerId: string): Promise<ExpelOutcome[]>;
  /** The neighbour sent nothing within 10 s: no routes through it. */
  markUnsynced(peerId: string): void;
  /** Creates and stores a signed expel on THIS node after the typed confirmation; rejects `invalid_request` for self or an unknown target without a record, `rate_limited`, `confirmation_mismatch`. The server floods it, then cuts. */
  createExpel(target: string, confirm: string): Promise<ExpelFrame>;
  /** `undefined` when the destination is not reachable (or is us). */
  route(dest: string): Route | undefined;
  isTombstoned(nodeId: string): boolean;
  /** Peers of ours (direct links) the group may announce us to: `linkUp` peers that are synced. */
  neighbours(): readonly string[];
  /** Fires when routes, the directory or the neighbour list changed (the server re-announces, coalesced). */
  onTopology(listener: () => void): () => void;
  /** Fires for every newly learned tombstone: the server closes links and every stream whose origin it is. */
  onTombstone(listener: TombstoneListener): () => void;
  /** A distance measured from a verified routed header (`DirectoryNode.skewMs`). */
  recordSkew(nodeId: string, skewMs: number): void;
}
