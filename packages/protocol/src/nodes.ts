import { Type } from "typebox";

/** `reconnecting` is "no heartbeat for 15 s"; `offline` is 45 s or a closed link; `update-required` is a protocol hash mismatch. */
export const NodeStatusSchema = Type.Union([
  Type.Literal("online"),
  Type.Literal("reconnecting"),
  Type.Literal("offline"),
  Type.Literal("update-required"),
]);
export type NodeStatus = Type.Static<typeof NodeStatusSchema>;

export const NodeLinkDirectionSchema = Type.Union([Type.Literal("accepted"), Type.Literal("dialled")]);
/** `accepted`: that node dialled us (a node device). `dialled`: we dial it (a `peers.json` entry). */
export type NodeLinkDirection = Type.Static<typeof NodeLinkDirectionSchema>;

/**
 * One link to a peer. `standby` is a dialled entry kept for recovery while another link to the same
 * node lives (glare); `duplicate` is a cloned identity that stopped redialling.
 */
export const NodeLinkStateSchema = Type.Union([
  Type.Literal("connecting"),
  Type.Literal("linked"),
  Type.Literal("reconnecting"),
  Type.Literal("unreachable"),
  Type.Literal("update-required"),
  Type.Literal("refused"),
  Type.Literal("duplicate"),
  Type.Literal("standby"),
]);
export type NodeLinkState = Type.Static<typeof NodeLinkStateSchema>;

/** What the dialler reports for one peer (`Core.nodes.reportLink`). */
export const NodeLinkReportSchema = Type.Object({
  state: NodeLinkStateSchema,
  /** A neutral sentence for the user ("Node unreachable", "Update tau on that node"). */
  message: Type.Union([Type.String(), Type.Null()]),
  since: Type.Union([Type.Number(), Type.Null()]),
});
export type NodeLinkReport = Type.Static<typeof NodeLinkReportSchema>;

export const NodeLinkSchema = Type.Object({
  direction: NodeLinkDirectionSchema,
  state: NodeLinkStateSchema,
  message: Type.Union([Type.String(), Type.Null()]),
  since: Type.Union([Type.Number(), Type.Null()]),
});
export type NodeLink = Type.Static<typeof NodeLinkSchema>;

/**
 * A peer of this tau. `id` is the peer's `nodeId` (the same from every viewpoint); a migrated 0.1.x
 * entry keeps its old device id until its first `hello` (`identified: false`).
 */
export const NodeSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  identified: Type.Boolean(),
  name: Type.String(),
  os: Type.String(),
  tauVersion: Type.String(),
  protocolVersion: Type.String(),
  status: NodeStatusSchema,
  /** Unix ms of the last heartbeat (or of the link closing). */
  lastSeenAt: Type.Number(),
  threadCount: Type.Number(),
  /** One entry per link to this peer, accepted and dialled (usually one). Empty only for a forgotten-in-flight peer. */
  links: Type.Array(NodeLinkSchema),
});
export type Node = Type.Static<typeof NodeSchema>;

/** This tau itself, as the "this node" row and the Nodes page need it. */
export const NodeSelfSchema = Type.Object({
  nodeId: Type.String(),
  publicKey: Type.String(),
  name: Type.String(),
  /** "darwin arm64". */
  os: Type.String(),
  tauVersion: Type.String(),
  protocolVersion: Type.String(),
  linkProtocol: Type.String(),
  capabilities: Type.Array(Type.String()),
});
export type NodeSelf = Type.Static<typeof NodeSelfSchema>;

export const RenameNodeBodySchema = Type.Object({ name: Type.String({ minLength: 1, maxLength: 120 }) });

/** What a node tells its peer when the link opens (the `hello` frame, minus its type). */
export const NodeHelloSchema = Type.Object({
  nodeId: Type.String({ minLength: 1, maxLength: 64 }),
  /** Raw Ed25519 public key (32 bytes), base64url. `nodeId = base32(sha256(publicKey bytes))`. */
  publicKey: Type.String({ minLength: 1, maxLength: 64 }),
  /** 16 random bytes, base64url: the peer signs it in its `proof`. */
  nonce: Type.String({ minLength: 1, maxLength: 32 }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  os: Type.String({ maxLength: 120 }),
  tauVersion: Type.String({ maxLength: 60 }),
  /** Routes, frames and `Change`: drives "Update tau" and whether the web may open that node's API. */
  protocolVersion: Type.String({ maxLength: 80 }),
  /** Hash of the BASE link frames only: decides whether two nodes may link. */
  linkProtocol: Type.String({ maxLength: 80 }),
  /** `announce` and `relay` arrive in Step 2; a Step 1 node lists none. */
  capabilities: Type.Array(Type.String({ maxLength: 40 }), { maxItems: 16 }),
});
export type NodeHello = Type.Static<typeof NodeHelloSchema>;

/**
 * What `Core.nodes.register` takes once a link is up: a verified `hello` (minus the nonce) or, for the
 * transitional 0.1.x one-way link, only name, os and versions. `nodeId` and `publicKey` are stored on the
 * node device (accepted) or the `peers.json` entry (dialled) the first time they are given.
 */
export interface NodePeerInfo {
  readonly name: string;
  readonly os: string;
  readonly tauVersion: string;
  readonly protocolVersion: string;
  readonly linkProtocol?: string;
  readonly capabilities?: readonly string[];
  readonly nodeId?: string;
  readonly publicKey?: string;
}

/** Peers a tau links to by default advertise nothing in Step 1. */
export const NODE_CAPABILITIES: readonly string[] = [];

/** Titles and times only, never transcripts: what the hub shows for an offline node. */
export const NodeSummarySchema = Type.Object({
  savedAt: Type.Number(),
  projects: Type.Array(Type.Object({ id: Type.String(), name: Type.String() })),
  threads: Type.Array(
    Type.Object({
      id: Type.String(),
      projectId: Type.String(),
      title: Type.String(),
      updatedAt: Type.Number(),
    }),
  ),
});
export type NodeSummary = Type.Static<typeof NodeSummarySchema>;

/** The hub proxies a node's API under this prefix: `/api/n/<nodeId>/api/...`. */
export const NODE_PROXY_PREFIX = "/api/n";

export const nodeApiPrefix = (nodeId: string): string => `${NODE_PROXY_PREFIX}/${encodeURIComponent(nodeId)}`;
