import { NONCE_CACHE_CAP, REQUEST_WINDOW_MS } from "../node-link-routing";

export interface NonceCache {
  /** `true` and remembers the nonce when it is new; `false` for a replay. */
  accept(key: string): boolean;
  readonly size: () => number;
}

/**
 * A bounded replay cache. An entry lives for twice the timestamp window (past that the timestamp check
 * already refuses it); beyond `cap` the oldest entry is dropped. The cache is lost on restart, which is why
 * the destination also refuses a `ts` earlier than its own boot time.
 */
export function createNonceCache(
  now: () => number,
  cap: number = NONCE_CACHE_CAP,
  ttlMs: number = REQUEST_WINDOW_MS * 2,
): NonceCache {
  const seen = new Map<string, number>();
  const expire = () => {
    const cutoff = now() - ttlMs;
    for (const [key, at] of seen) {
      if (at >= cutoff) break;
      seen.delete(key);
    }
  };
  return {
    accept(key) {
      expire();
      if (seen.has(key)) return false;
      seen.set(key, now());
      while (seen.size > cap) seen.delete(seen.keys().next().value as string);
      return true;
    },
    size: () => seen.size,
  };
}
