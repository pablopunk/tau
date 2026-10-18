import { createHash, timingSafeEqual } from "node:crypto";

export const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

/** Equal-length digests compared in constant time. */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}
