import { randomBytes } from "node:crypto";
import {
  type Core,
  type HelloFrame,
  LINK_CLOSE_POLICY,
  LINK_CLOSE_UPDATE_REQUIRED,
  type NodeSelf,
  type ProofFrame,
} from "@tau/protocol";
import {
  closeCodeFor,
  createHello,
  DOMAIN_TAGS,
  signedPayload,
  verifyHello,
  verifyProof,
} from "@tau/protocol/identity";

export type Check =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: number; readonly reason: string };

const REFUSED = { ok: false } as const;

/** Our `hello`. The private key never leaves core, so `createHello` gets the public half only (it never signs). */
export function buildHello(self: NodeSelf): HelloFrame {
  return createHello(
    { publicKey: self.publicKey, privateKey: "" },
    {
      name: self.name,
      os: self.os,
      tauVersion: self.tauVersion,
      protocolVersion: self.protocolVersion,
      linkProtocol: self.linkProtocol,
      capabilities: self.capabilities,
    },
    randomBytes,
  );
}

/** The answer to the peer's `hello`, signed by core: `tau-proof-v1|<peer nonce>|<own nodeId>|<peer nodeId>`. */
export async function buildProof(
  core: Core,
  own: Pick<NodeSelf, "nodeId">,
  peerHello: Pick<HelloFrame, "nonce" | "nodeId">,
): Promise<ProofFrame> {
  const payload = signedPayload(DOMAIN_TAGS.proof, peerHello.nonce, own.nodeId, peerHello.nodeId);
  return { type: "proof", payload, sig: await core.nodes.sign(payload) };
}

/** The peer's `hello`: a forged id, a reflected hello, a wrong pin (`closeCodeFor`) or another `linkProtocol` (4001). */
export function checkHello(
  hello: HelloFrame,
  own: Pick<NodeSelf, "nodeId" | "linkProtocol">,
  pinnedNodeId: string | undefined,
): Check {
  const verdict = verifyHello(hello, { ownNodeId: own.nodeId, pinnedNodeId });
  if (!verdict.ok) return { ...REFUSED, code: closeCodeFor(verdict.reason), reason: verdict.reason };
  if (hello.linkProtocol !== own.linkProtocol)
    return { ...REFUSED, code: LINK_CLOSE_UPDATE_REQUIRED, reason: "update required" };
  return { ok: true };
}

export function checkProof(proof: ProofFrame, ownHello: HelloFrame, peerHello: HelloFrame): Check {
  const verdict = verifyProof(proof, { ownHello, peerHello });
  return verdict.ok ? verdict : { ...REFUSED, code: LINK_CLOSE_POLICY, reason: verdict.reason };
}
