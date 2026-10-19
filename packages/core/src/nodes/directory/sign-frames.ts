import { hostname } from "node:os";
import type { AnnounceFrame, ExpelAckFrame, ExpelFrame } from "@tau/protocol";
import { LINK_PROTOCOL, PROTOCOL_VERSION } from "@tau/protocol";
import { ackPayload, announcePayload, expelPayload } from "@tau/protocol/identity";
import type { NodeIdentity } from "../../identity/node-identity";
import type { DirectoryDeps } from "./ports";

/** What an announce says about this node. The frozen `DirectoryDeps` has no self info; the integrator may pass `self`. */
export interface SelfInfo {
  readonly name: string;
  readonly os: string;
  readonly tauVersion: string;
  readonly protocolVersion: string;
  readonly linkProtocol: string;
}
export type DirectoryDepsWithSelf = DirectoryDeps & { readonly self?: () => SelfInfo };

export const defaultSelf = (): SelfInfo => ({
  name: hostname().replace(/\.local$/i, ""),
  os: `${process.platform} ${process.arch}`,
  tauVersion: "unknown",
  protocolVersion: PROTOCOL_VERSION,
  linkProtocol: LINK_PROTOCOL,
});

/** Same bytes as protocol's `createAnnounce`/`createExpel`/`createAck` (one payload builder each); core signs through `identity.sign`. */
export function signAnnounce(
  identity: NodeIdentity,
  body: { boot: number; counter: number; neighbours: readonly string[]; self: SelfInfo },
  ttl: number,
): AnnounceFrame {
  const { self, ...rest } = body;
  const payload = announcePayload(identity.nodeId, identity.publicKey, { ...rest, ...self });
  return { type: "announce", payload, sig: identity.sign(payload), ttl };
}

export function signExpel(identity: NodeIdentity, target: string, time: number): ExpelFrame {
  const payload = expelPayload(target, identity.nodeId, time);
  return { type: "expel", payload, byPublicKey: identity.publicKey, sig: identity.sign(payload) };
}

export function signAck(identity: NodeIdentity, target: string, time: number): ExpelAckFrame {
  const payload = ackPayload(target, identity.nodeId, time);
  return { type: "expel-ack", payload, nodePublicKey: identity.publicKey, sig: identity.sign(payload) };
}
