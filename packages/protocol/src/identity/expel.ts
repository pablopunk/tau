import type { ExpelAckFrame, ExpelFrame } from "../node-link-routing";
import { parseCount } from "./fields";
import { isPublicKey, type NodeKeys, nodeIdOf, signPayload, verifySignature } from "./keys";
import { DOMAIN_TAGS, parseSignedPayload, signedPayload } from "./signed-payload";

export interface ExpelRecord {
  readonly target: string;
  readonly by: string;
  readonly time: number;
}

/** `tau-expel-v1|<target>|<by>|<time>`: no sequence number, idempotent per target. */
export function createExpel(keys: NodeKeys, target: string, time: number): ExpelFrame {
  const payload = signedPayload(DOMAIN_TAGS.expel, target, nodeIdOf(keys.publicKey), String(time));
  return { type: "expel", payload, byPublicKey: keys.publicKey, sig: signPayload(keys, payload) };
}

export type ExpelRefusal = "bad-payload" | "bad-key" | "self-expel" | "bad-signature";
export type ExpelVerdict =
  | { readonly ok: true; readonly record: ExpelRecord }
  | { readonly ok: false; readonly reason: ExpelRefusal };

/**
 * Valid when `sha256(byPublicKey) == by` and the signature holds. NEVER judged by the signer's later status
 * and there is no "seen before" rule (union of verified expels). Rate limits and the 256 cap are the directory's.
 */
export function verifyExpel(frame: Pick<ExpelFrame, "payload" | "byPublicKey" | "sig">): ExpelVerdict {
  const fields = parseSignedPayload(frame.payload, DOMAIN_TAGS.expel, 3);
  const time = parseCount(fields?.[2]);
  if (!fields || time === undefined) return { ok: false, reason: "bad-payload" };
  const [target, by] = fields as [string, string, string];
  if (!isPublicKey(frame.byPublicKey) || nodeIdOf(frame.byPublicKey) !== by)
    return { ok: false, reason: "bad-key" };
  if (target === by) return { ok: false, reason: "self-expel" };
  if (!verifySignature(frame.byPublicKey, frame.payload, frame.sig))
    return { ok: false, reason: "bad-signature" };
  return { ok: true, record: { target, by, time } };
}

export interface AckRecord {
  readonly target: string;
  readonly node: string;
  readonly time: number;
}

/** `tau-ack-v1|<target>|<node>|<time>`, signed by `node`: it applied the expel of `target`. */
export function createAck(keys: NodeKeys, target: string, time: number): ExpelAckFrame {
  const payload = signedPayload(DOMAIN_TAGS.ack, target, nodeIdOf(keys.publicKey), String(time));
  return { type: "expel-ack", payload, nodePublicKey: keys.publicKey, sig: signPayload(keys, payload) };
}

export type AckVerdict =
  | { readonly ok: true; readonly record: AckRecord }
  | { readonly ok: false; readonly reason: "bad-payload" | "bad-key" | "bad-signature" };

export function verifyAck(frame: Pick<ExpelAckFrame, "payload" | "nodePublicKey" | "sig">): AckVerdict {
  const fields = parseSignedPayload(frame.payload, DOMAIN_TAGS.ack, 3);
  const time = parseCount(fields?.[2]);
  if (!fields || time === undefined) return { ok: false, reason: "bad-payload" };
  const [target, node] = fields as [string, string, string];
  if (!isPublicKey(frame.nodePublicKey) || nodeIdOf(frame.nodePublicKey) !== node)
    return { ok: false, reason: "bad-key" };
  if (!verifySignature(frame.nodePublicKey, frame.payload, frame.sig))
    return { ok: false, reason: "bad-signature" };
  return { ok: true, record: { target, node, time } };
}
