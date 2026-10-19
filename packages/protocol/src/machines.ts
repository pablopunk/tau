import { Type } from "typebox";

/** `reconnecting` is "no heartbeat for 15 s"; `offline` is 45 s or a closed link; `update-required` is a protocol hash mismatch. */
export const MachineStatusSchema = Type.Union([
  Type.Literal("online"),
  Type.Literal("reconnecting"),
  Type.Literal("offline"),
  Type.Literal("update-required"),
]);
export type MachineStatus = Type.Static<typeof MachineStatusSchema>;

/** A tau that linked itself to this hub. `id` is the machine's device id in the access store. */
export const MachineSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String(),
  os: Type.String(),
  tauVersion: Type.String(),
  protocolVersion: Type.String(),
  status: MachineStatusSchema,
  /** Unix ms of the last heartbeat (or of the link closing). */
  lastSeenAt: Type.Number(),
  threadCount: Type.Number(),
  /** Set only while this tau is itself linked to a hub: the hub's name (the "this machine" row). */
  linkedTo: Type.Optional(Type.String()),
});
export type Machine = Type.Static<typeof MachineSchema>;

export const RenameMachineBodySchema = Type.Object({ name: Type.String({ minLength: 1, maxLength: 120 }) });

/** The link of this tau to its hub, as the machine sees it ("Linked to <hub>", "Hub unreachable"). */
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
});
export type HubLink = Type.Static<typeof HubLinkSchema>;

export const HUB_LINK_NONE: HubLink = {
  state: "none",
  hubName: null,
  hubUrl: null,
  since: null,
  message: null,
};

/** What a machine tells the hub when the link opens (the `hello` frame, minus its type). */
export const MachineHelloSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  os: Type.String({ maxLength: 120 }),
  tauVersion: Type.String({ maxLength: 60 }),
  protocolVersion: Type.String({ maxLength: 80 }),
  threadCount: Type.Number(),
});
export type MachineHello = Type.Static<typeof MachineHelloSchema>;

/** Titles and times only, never transcripts: what the hub shows for an offline machine. */
export const MachineSummarySchema = Type.Object({
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
export type MachineSummary = Type.Static<typeof MachineSummarySchema>;

/** The hub proxies a machine's API under this prefix: `/api/m/<machineId>/api/...`. */
export const MACHINE_PROXY_PREFIX = "/api/m";

export const machineApiPrefix = (machineId: string): string =>
  `${MACHINE_PROXY_PREFIX}/${encodeURIComponent(machineId)}`;
