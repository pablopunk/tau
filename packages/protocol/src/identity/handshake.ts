import { randomBytes } from "node:crypto";
import {
  type HelloFrame,
  LINK_CLOSE_DUPLICATE,
  LINK_CLOSE_POLICY,
  NONCE_BYTES,
  type ProofFrame,
} from "../node-link";
import { isPublicKey, type NodeKeys, nodeIdOf, signPayload, verifySignature } from "./keys";
import { DOMAIN_TAGS, parseSignedPayload, signedPayload } from "./signed-payload";

export type HelloInfo = Pick<
  HelloFrame,
  "name" | "os" | "tauVersion" | "protocolVersion" | "linkProtocol" | "capabilities"
>;

/** Both ends send this first, in any order; `nonce` is 16 fresh random bytes. */
export function createHello(
  keys: NodeKeys,
  info: HelloInfo,
  random: (size: number) => Buffer = randomBytes,
): HelloFrame {
  return {
    type: "hello",
    nodeId: nodeIdOf(keys.publicKey),
    publicKey: keys.publicKey,
    nonce: random(NONCE_BYTES).toString("base64url"),
    ...info,
  };
}

export type HelloRefusal = "bad-key" | "bad-nonce" | "id-mismatch" | "self" | "pin-mismatch";
export type HelloVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: HelloRefusal };

/** Close code for a refused handshake: a link to oneself is 4002 (never retried), everything else 1008. */
export const closeCodeFor = (reason: HelloRefusal): number =>
  reason === "self" ? LINK_CLOSE_DUPLICATE : LINK_CLOSE_POLICY;

/**
 * Checks a received `hello`: the id is the hash of the key (a different key cannot claim an id), the
 * nonce is 16 bytes, it is not our own (a reflected hello), and it is the pinned id when one is pinned.
 */
export function verifyHello(
  hello: HelloFrame,
  context: { readonly ownNodeId: string; readonly pinnedNodeId?: string },
): HelloVerdict {
  if (!isPublicKey(hello.publicKey)) return { ok: false, reason: "bad-key" };
  if (Buffer.from(hello.nonce, "base64url").length !== NONCE_BYTES) return { ok: false, reason: "bad-nonce" };
  if (nodeIdOf(hello.publicKey) !== hello.nodeId) return { ok: false, reason: "id-mismatch" };
  if (hello.nodeId === context.ownNodeId) return { ok: false, reason: "self" };
  if (context.pinnedNodeId !== undefined && hello.nodeId !== context.pinnedNodeId) {
    return { ok: false, reason: "pin-mismatch" };
  }
  return { ok: true };
}

/** `tau-proof-v1|<peer nonce>|<own nodeId>|<peer nodeId>`, signed verbatim: it answers THAT peer's hello. */
export function createProof(keys: NodeKeys, peerHello: Pick<HelloFrame, "nonce" | "nodeId">): ProofFrame {
  const payload = signedPayload(
    DOMAIN_TAGS.proof,
    peerHello.nonce,
    nodeIdOf(keys.publicKey),
    peerHello.nodeId,
  );
  return { type: "proof", payload, sig: signPayload(keys, payload) };
}

export type ProofRefusal = "bad-payload" | "bad-signature";
export type ProofVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: ProofRefusal };

/**
 * Checks a received `proof` against OUR hello and the peer's verified hello: the payload must name our
 * nonce and the two ids in the peer's order (so a replay from an older session, a reflected proof and a
 * proof for another pair all fail) and the signature must verify with the key the peer's hello carried.
 */
export function verifyProof(
  proof: ProofFrame,
  context: { readonly ownHello: Pick<HelloFrame, "nonce" | "nodeId">; readonly peerHello: HelloFrame },
): ProofVerdict {
  const { ownHello, peerHello } = context;
  const expected = signedPayload(DOMAIN_TAGS.proof, ownHello.nonce, peerHello.nodeId, ownHello.nodeId);
  if (proof.payload !== expected || !parseSignedPayload(proof.payload, DOMAIN_TAGS.proof, 3)) {
    return { ok: false, reason: "bad-payload" };
  }
  if (!verifySignature(peerHello.publicKey, proof.payload, proof.sig))
    return { ok: false, reason: "bad-signature" };
  return { ok: true };
}
