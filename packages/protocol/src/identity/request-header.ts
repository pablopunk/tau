import { randomBytes } from "node:crypto";
import { REQUEST_WINDOW_MS, type RoutedFields } from "../node-link-routing";
import { encodeField } from "./fields";
import { isPublicKey, type NodeKeys, nodeIdOf, signPayload, verifySignature } from "./keys";
import type { NonceCache } from "./nonce-cache";
import { DOMAIN_TAGS, signedPayload } from "./signed-payload";
import { withinWindow } from "./time-window";

/** The plain fields of a `request` (or `open`, which has no method, content type or body) that the signature covers. */
export interface RequestHeaderFields {
  readonly dest: string;
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly contentType?: string;
  readonly bodyBytes?: number;
  readonly via: string;
}

const canonical = (fields: RequestHeaderFields, origin: string, ts: number, nonce: string): string =>
  signedPayload(
    DOMAIN_TAGS.request,
    fields.dest,
    origin,
    encodeField(fields.method),
    encodeField(fields.path),
    encodeField(fields.query),
    encodeField(fields.contentType ?? ""),
    fields.bodyBytes === undefined ? "" : String(fields.bodyBytes),
    encodeField(fields.via),
    String(ts),
    nonce,
  );

/** Signs the routed header at the origin: `dest, origin, method, path, query, contentType, bodyBytes, via, ts, nonce`. */
export function signRequestHeader(
  keys: NodeKeys,
  fields: RequestHeaderFields,
  now: number,
  nonce: string = randomBytes(12).toString("base64url"),
): Required<Pick<RoutedFields, "dest" | "origin" | "originPublicKey" | "payload" | "originSig">> {
  const origin = nodeIdOf(keys.publicKey);
  const payload = canonical(fields, origin, now, nonce);
  return {
    dest: fields.dest,
    origin,
    originPublicKey: keys.publicKey,
    payload,
    originSig: signPayload(keys, payload),
  };
}

export type RequestRefusal =
  | "missing"
  | "wrong-dest"
  | "bad-key"
  | "mismatch"
  | "bad-signature"
  | "skew"
  | "before-boot"
  | "replay"
  | "tombstoned";

export type RequestVerdict =
  | { readonly ok: true; readonly origin: string; readonly ts: number }
  | { readonly ok: false; readonly reason: RequestRefusal; readonly skewMs?: number };

export interface RequestContext {
  readonly ownNodeId: string;
  readonly now: number;
  /** This node's own boot time: a `ts` before it is refused (the nonce cache is lost on restart). */
  readonly bootAt: number;
  readonly nonces: NonceCache;
  readonly isTombstoned?: (nodeId: string) => boolean;
  readonly windowMs?: number;
}

/**
 * At the destination: the payload must say exactly what the frame says (nothing was swapped around the
 * signature), the key must hash to `origin`, the signature must hold, `ts` within ±120 s and not before boot,
 * the origin not tombstoned, and the nonce new (remembered only AFTER the signature verified, so a forger
 * cannot burn nonces). Gives attribution and replay protection, NOT body or stream integrity.
 */
export function verifyRequestHeader(
  frame: RequestHeaderFields & RoutedFields,
  context: RequestContext,
): RequestVerdict {
  const { origin, originPublicKey, payload, originSig } = frame;
  if (!origin || !originPublicKey || !payload || !originSig) return { ok: false, reason: "missing" };
  if (frame.dest !== context.ownNodeId) return { ok: false, reason: "wrong-dest" };
  if (!isPublicKey(originPublicKey) || nodeIdOf(originPublicKey) !== origin)
    return { ok: false, reason: "bad-key" };
  const parts = payload.split("|");
  const ts = Number(parts[9]);
  const nonce = parts[10];
  if (parts.length !== 11 || !Number.isSafeInteger(ts) || !nonce) return { ok: false, reason: "mismatch" };
  if (payload !== canonical(frame, origin, ts, nonce)) return { ok: false, reason: "mismatch" };
  if (!verifySignature(originPublicKey, payload, originSig)) return { ok: false, reason: "bad-signature" };
  if (!withinWindow(ts, context.now, context.windowMs ?? REQUEST_WINDOW_MS)) {
    return { ok: false, reason: "skew", skewMs: ts - context.now };
  }
  if (ts < context.bootAt) return { ok: false, reason: "before-boot" };
  if (context.isTombstoned?.(origin)) return { ok: false, reason: "tombstoned" };
  if (!context.nonces.accept(`${origin}:${nonce}`)) return { ok: false, reason: "replay" };
  return { ok: true, origin, ts };
}
