import { Type } from "typebox";

export const RemoteStateSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("starting"),
  Type.Literal("online"),
  Type.Literal("reconnecting"),
  Type.Literal("error"),
]);
export type RemoteState = Type.Static<typeof RemoteStateSchema>;

export const RemoteSettingsSchema = Type.Object({ enabled: Type.Boolean() });
export type RemoteSettings = Type.Static<typeof RemoteSettingsSchema>;

/** The tunnel as the user sees it. `url` is `https://<hostname>` and stays while the tunnel exists. */
export const RemoteStatusSchema = Type.Object({
  state: RemoteStateSchema,
  url: Type.Union([Type.String(), Type.Null()]),
  /** Unix ms of the last state change. */
  since: Type.Union([Type.Number(), Type.Null()]),
  /** A neutral sentence for the user, never raw relay text. */
  message: Type.Union([Type.String(), Type.Null()]),
  /** A removal of an old tunnel is still waiting for the network. */
  pendingRemoval: Type.Boolean(),
  /** `reconnecting` for 10 minutes: "Make a new URL" is offered. */
  canRecreate: Type.Boolean(),
});
export type RemoteStatus = Type.Static<typeof RemoteStatusSchema>;

export const REMOTE_OFF: RemoteStatus = {
  state: "off",
  url: null,
  since: null,
  message: null,
  pendingRemoval: false,
  canRecreate: false,
};

export const HealthSchema = Type.Object({ ok: Type.Literal(true) });
export type Health = Type.Static<typeof HealthSchema>;
