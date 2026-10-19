import { type AnnounceFrame, GROUP_NODE_CAP } from "../node-link-routing";
import { decodeField, encodeField, parseCount } from "./fields";
import { isPublicKey, type NodeKeys, nodeIdOf, signPayload, verifySignature } from "./keys";
import { DOMAIN_TAGS, parseSignedPayload, signedPayload } from "./signed-payload";

/** What an announce says about its origin (the payload, decoded). */
export interface AnnounceRecord {
  readonly origin: string;
  readonly publicKey: string;
  readonly boot: number;
  readonly counter: number;
  readonly name: string;
  readonly os: string;
  readonly tauVersion: string;
  readonly protocolVersion: string;
  readonly linkProtocol: string;
  readonly neighbours: readonly string[];
}

export type AnnounceBody = Omit<AnnounceRecord, "origin" | "publicKey">;
const FIELD_COUNT = 10;
/** More than the group cap minus self is a lie or an attack. */
export const ANNOUNCE_MAX_NEIGHBOURS = GROUP_NODE_CAP - 1;

/** `tau-announce-v1|origin|publicKey|boot|counter|name|os|tauVersion|protocolVersion|linkProtocol|n1,n2`. `ttl` is outside it. */
export function announcePayload(origin: string, publicKey: string, body: AnnounceBody): string {
  return signedPayload(
    DOMAIN_TAGS.announce,
    origin,
    publicKey,
    String(body.boot),
    String(body.counter),
    encodeField(body.name),
    encodeField(body.os),
    encodeField(body.tauVersion),
    encodeField(body.protocolVersion),
    encodeField(body.linkProtocol),
    [...body.neighbours].join(","),
  );
}

export function createAnnounce(keys: NodeKeys, body: AnnounceBody, ttl: number): AnnounceFrame {
  const payload = announcePayload(nodeIdOf(keys.publicKey), keys.publicKey, body);
  return { type: "announce", payload, sig: signPayload(keys, payload), ttl };
}

export type AnnounceRefusal =
  | "bad-payload"
  | "bad-key"
  | "key-mismatch"
  | "bad-signature"
  | "too-many-neighbours";
export type AnnounceVerdict =
  | { readonly ok: true; readonly record: AnnounceRecord }
  | { readonly ok: false; readonly reason: AnnounceRefusal };

/**
 * Checks `sha256(publicKey) == origin`, that a KNOWN key for that id is the same one (`knownKey`), the
 * signature, and the list bound. Order, expiry, the cap and "an announce about the receiver" are the
 * directory's job (owner E).
 */
export function verifyAnnounce(
  frame: Pick<AnnounceFrame, "payload" | "sig">,
  context: { readonly knownKey?: string } = {},
): AnnounceVerdict {
  const fields = parseSignedPayload(frame.payload, DOMAIN_TAGS.announce, FIELD_COUNT);
  if (!fields) return { ok: false, reason: "bad-payload" };
  const [origin, publicKey, boot, counter, name, os, tauVersion, protocolVersion, linkProtocol, listed] =
    fields as [string, string, string, string, string, string, string, string, string, string];
  const bootN = parseCount(boot);
  const counterN = parseCount(counter);
  const decoded = [name, os, tauVersion, protocolVersion, linkProtocol].map(decodeField);
  if (bootN === undefined || counterN === undefined || decoded.includes(undefined)) {
    return { ok: false, reason: "bad-payload" };
  }
  if (!isPublicKey(publicKey) || nodeIdOf(publicKey) !== origin) return { ok: false, reason: "bad-key" };
  if (context.knownKey !== undefined && context.knownKey !== publicKey) {
    return { ok: false, reason: "key-mismatch" };
  }
  const neighbours = listed === "" ? [] : listed.split(",");
  if (neighbours.length > ANNOUNCE_MAX_NEIGHBOURS) return { ok: false, reason: "too-many-neighbours" };
  if (new Set(neighbours).size !== neighbours.length || neighbours.includes(origin)) {
    return { ok: false, reason: "bad-payload" };
  }
  if (!verifySignature(publicKey, frame.payload, frame.sig)) return { ok: false, reason: "bad-signature" };
  const [n, o, t, p, l] = decoded as string[];
  return {
    ok: true,
    record: {
      origin,
      publicKey,
      boot: bootN,
      counter: counterN,
      name: n as string,
      os: o as string,
      tauVersion: t as string,
      protocolVersion: p as string,
      linkProtocol: l as string,
      neighbours,
    },
  };
}
