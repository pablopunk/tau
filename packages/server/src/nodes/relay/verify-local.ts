import type { Core } from "@tau/protocol";
import { createNonceCache, type NonceCache, verifyRequestHeader } from "@tau/protocol/identity";
import type { IncomingOpen } from "../link-mux";
import { POLICY, REFUSAL_REASONS } from "./refusals";

export interface Refusal {
  readonly code: number;
  readonly reason: string;
}

export interface LocalVerifier {
  /** `undefined` when the routed header is valid for this node (and remembered); else why the frame dies here. */
  verify(frame: IncomingOpen, ownNodeId: string): Refusal | undefined;
}

/** The destination check of a routed frame: signature, ±120 s window, boot time, replay, tombstone. */
export function createLocalVerifier(core: Core, now: () => number, bootAt: number): LocalVerifier {
  const nonces: NonceCache = createNonceCache(now);
  return {
    verify(frame, ownNodeId) {
      const request = frame.type === "request";
      const verdict = verifyRequestHeader(
        {
          dest: frame.dest ?? "",
          method: request ? frame.method : "",
          path: frame.path,
          query: frame.query,
          via: frame.via,
          ...(request && frame.contentType !== undefined && { contentType: frame.contentType }),
          ...(request && frame.bodyBytes !== undefined && { bodyBytes: frame.bodyBytes }),
          origin: frame.origin,
          originPublicKey: frame.originPublicKey,
          payload: frame.payload,
          originSig: frame.originSig,
        },
        { ownNodeId, now: now(), bootAt, nonces, isTombstoned: (id) => core.nodes.group.isTombstoned(id) },
      );
      if (verdict.ok) {
        if (frame.origin) core.nodes.group.recordSkew(frame.origin, verdict.ts - now());
        return undefined;
      }
      if (verdict.reason === "skew") {
        if (frame.origin) core.nodes.group.recordSkew(frame.origin, verdict.skewMs ?? 0);
        return { code: POLICY, reason: REFUSAL_REASONS.clock_skew };
      }
      if (verdict.reason === "tombstoned") return { code: POLICY, reason: REFUSAL_REASONS.node_removed };
      return { code: POLICY, reason: `refused: ${verdict.reason}` };
    },
  };
}
