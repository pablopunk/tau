import { Type } from "typebox";

export const DeviceKindSchema = Type.Union([
  Type.Literal("browser"),
  Type.Literal("phone"),
  Type.Literal("cli"),
  Type.Literal("node"), // the file store still writes "machine" for one release (core/src/access)
]);
export type DeviceKind = Type.Static<typeof DeviceKindSchema>;

export const DeviceSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String(),
  kind: DeviceKindSchema,
  createdAt: Type.Number(),
  lastSeenAt: Type.Number(),
  /** The device that asks; always `false` for nodes. */
  current: Type.Boolean(),
  os: Type.Optional(Type.String()),
  tauVersion: Type.Optional(Type.String()),
  protocolVersion: Type.Optional(Type.String()),
  /** The verified `nodeId` of a node device, set at its first `hello`. */
  nodeId: Type.Optional(Type.String()),
});
export type Device = Type.Static<typeof DeviceSchema>;

export const PairingKindSchema = Type.Union([Type.Literal("device"), Type.Literal("node")]);
export type PairingKind = Type.Static<typeof PairingKindSchema>;

/** The query of `POST /api/pair` (no body, so `tau pair new` needs none). */
export const MintPairingInputSchema = Type.Object({
  kind: Type.Optional(PairingKindSchema),
  /** A label for the new device, carried in the link as `#<code>.<name>`. */
  name: Type.Optional(Type.String({ maxLength: 120 })),
});
export type MintPairingInput = Type.Static<typeof MintPairingInputSchema>;

/**
 * The one place that builds a pairing link: `<url>/pair#<code>[.<name>][&node=<nodeId>]`.
 * `node` is the acceptor's own `nodeId`, so the dialler can check it at the first `hello`.
 */
export function pairingLink(url: string, code: string, name?: string, nodeId?: string): string {
  const label = name?.trim();
  const node = nodeId ? `&node=${encodeURIComponent(nodeId)}` : "";
  return `${url}/pair#${code}${label ? `.${encodeURIComponent(label)}` : ""}${node}`;
}

export const PAIRING_TTL_MS = 5 * 60 * 1000;
export const MAX_LIVE_PAIRINGS = 5;

export const MintedPairingSchema = Type.Object({
  kind: PairingKindSchema,
  /** 128 bits, for the link fragment. */
  code: Type.String(),
  /** 8 characters without lookalikes, typed on `/pair`. */
  shortCode: Type.String(),
  /** `https://<hostname>/pair#<code>`; `null` while remote is off. */
  link: Type.Union([Type.String(), Type.Null()]),
  expiresAt: Type.Number(),
  /** The minting node's own `nodeId`, so a short code can be checked too. */
  nodeId: Type.Optional(Type.String()),
});
export type MintedPairing = Type.Static<typeof MintedPairingSchema>;

export const RedeemPairingBodySchema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 256 }),
  deviceName: Type.String({ maxLength: 120 }),
});
export type RedeemPairingBody = Type.Static<typeof RedeemPairingBodySchema>;

/** What the REST route answers. `secret` is present only for a `node` pairing; a device gets its cookie. */
export const RedeemPairingResponseSchema = Type.Object({
  deviceId: Type.String(),
  secret: Type.Optional(Type.String()),
  /** For a `node` pairing: the acceptor's `nodeId` (the dialler pins it at the first `hello`). */
  nodeId: Type.Optional(Type.String()),
});
export type RedeemPairingResponse = Type.Static<typeof RedeemPairingResponseSchema>;

/** What `Core.access.redeemPairing` takes: the body plus where the request came from (PROXY peer or loopback). */
export interface RedeemPairingInput extends RedeemPairingBody {
  readonly peer: string;
  /** The `User-Agent`, used for the device name when the body has none. */
  readonly userAgent?: string;
}

export interface RedeemedPairing {
  readonly deviceId: string;
  readonly kind: PairingKind;
  /** 32 random bytes, hex. Shown once: the server turns it into a cookie or a node response. */
  readonly secret: string;
  /** The acceptor's own `nodeId` for a `node` pairing. */
  readonly nodeId?: string;
}

export const RenameDeviceBodySchema = Type.Object({ name: Type.String({ minLength: 1, maxLength: 120 }) });
