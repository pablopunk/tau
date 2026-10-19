import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { base32 } from "./base32";

/** Both halves are raw Ed25519 values (32 bytes) in base64url, the JWK `x` and `d`. This is what `node.json` stores. */
export interface NodeKeys {
  readonly publicKey: string;
  readonly privateKey: string;
}

const KEY_BYTES = 32;
const SIGNATURE_BYTES = 64;

const decode = (value: string): Buffer => Buffer.from(value, "base64url");
const canonical = (value: string, bytes: number): boolean =>
  decode(value).length === bytes && decode(value).toString("base64url") === value;

export const isPublicKey = (value: string): boolean => canonical(value, KEY_BYTES);
export const isSignature = (value: string): boolean => canonical(value, SIGNATURE_BYTES);

export function generateNodeKeys(): NodeKeys {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  return { publicKey: jwk.x as string, privateKey: jwk.d as string };
}

/** `nodeId = base32(sha256(raw public key bytes))`: self-certifying, 52 characters. */
export function nodeIdOf(publicKey: string): string {
  return base32(createHash("sha256").update(decode(publicKey)).digest());
}

export function keysMatch(keys: NodeKeys): boolean {
  if (!isPublicKey(keys.publicKey) || !canonical(keys.privateKey, KEY_BYTES)) return false;
  const probe = "tau-key-check";
  return verifySignature(keys.publicKey, probe, signPayload(keys, probe));
}

/** Signs the string verbatim (never re-serialised JSON). */
export function signPayload(keys: NodeKeys, payload: string): string {
  const key = createPrivateKey({
    key: { kty: "OKP", crv: "Ed25519", x: keys.publicKey, d: keys.privateKey },
    format: "jwk",
  });
  return sign(null, Buffer.from(payload), key).toString("base64url");
}

/** `false` for a malformed key or signature, never throws. */
export function verifySignature(publicKey: string, payload: string, sig: string): boolean {
  if (!isPublicKey(publicKey) || !isSignature(sig)) return false;
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKey }, format: "jwk" });
    return verify(null, Buffer.from(payload), key, decode(sig));
  } catch {
    return false;
  }
}
