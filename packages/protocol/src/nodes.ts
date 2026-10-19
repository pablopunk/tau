import { Type } from "typebox";

/** `reconnecting` is "no heartbeat for 15 s"; `offline` is 45 s or a closed link; `update-required` is a protocol hash mismatch. */
export const NodeStatusSchema = Type.Union([
  Type.Literal("online"),
  Type.Literal("reconnecting"),
  Type.Literal("offline"),
  Type.Literal("update-required"),
]);
export type NodeStatus = Type.Static<typeof NodeStatusSchema>;

/** A tau that linked itself to this hub. `id` is the node's device id in the access store. */
export const NodeSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String(),
  os: Type.String(),
  tauVersion: Type.String(),
  protocolVersion: Type.String(),
  status: NodeStatusSchema,
  /** Unix ms of the last heartbeat (or of the link closing). */
  lastSeenAt: Type.Number(),
  threadCount: Type.Number(),
  /** Set only while this tau is itself linked to a hub: the hub's name (the "this node" row). */
  linkedTo: Type.Optional(Type.String()),
});
export type Node = Type.Static<typeof NodeSchema>;

export const RenameNodeBodySchema = Type.Object({ name: Type.String({ minLength: 1, maxLength: 120 }) });

/** The link of this tau to its hub, as the node sees it ("Linked to <hub>", "Hub unreachable"). */
export const HubLinkStateSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("connecting"),
  Type.Literal("linked"),
  Type.Literal("reconnecting"),
  Type.Literal("unreachable"),
  Type.Literal("update-required"),
  Type.Literal("refused"),
]);
export type HubLinkStateName = Type.Static<typeof HubLinkStateSchema>;

export const HubLinkSchema = Type.Object({
  state: HubLinkStateSchema,
  hubName: Type.Union([Type.String(), Type.Null()]),
  hubUrl: Type.Union([Type.String(), Type.Null()]),
  since: Type.Union([Type.Number(), Type.Null()]),
  /** A neutral sentence for the user ("Hub unreachable", "Update tau on the hub"). */
  message: Type.Union([Type.String(), Type.Null()]),
  /** The OS of this tau itself ("darwin arm64"), set by core on every read. */
  os: Type.Optional(Type.String()),
  /** The name of this tau itself (its hostname without ".local"), set by core on every read. */
  name: Type.Optional(Type.String()),
});
export type HubLink = Type.Static<typeof HubLinkSchema>;

export const HUB_LINK_NONE: HubLink = {
  state: "none",
  hubName: null,
  hubUrl: null,
  since: null,
  message: null,
};

/** What a node tells the hub when the link opens (the `hello` frame, minus its type). */
export const NodeHelloSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  os: Type.String({ maxLength: 120 }),
  tauVersion: Type.String({ maxLength: 60 }),
  protocolVersion: Type.String({ maxLength: 80 }),
  threadCount: Type.Number(),
});
export type NodeHello = Type.Static<typeof NodeHelloSchema>;

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
