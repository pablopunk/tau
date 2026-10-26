import type { Availability, DecideClient } from "./client";

/** How long a `ready`/`unavailable` probe result is trusted for one key. */
export const DECISIONS_AVAILABILITY_TTL_MS = 24 * 60 * 60 * 1000;

/** Short non-secret fingerprint so a key change re-probes without storing the key. */
export function fingerprintKey(key: string | undefined): string {
  if (key === undefined) return "none";
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (Math.imul(hash, 31) + key.charCodeAt(index)) | 0;
  }
  return `k${(hash >>> 0).toString(36)}:${key.length}`;
}

/** Live clients report HTTP status as `(404)` in the message; a live 404 demotes the backend. */
export function isDecisionsNotFound(error: unknown): boolean {
  return error instanceof Error && /\(404\)/.test(error.message);
}

export interface AvailabilityCache {
  /** Cached probe; `unknown` is never cached hard so callers try live. Never rejects. */
  check(client: DecideClient, key: string | undefined): Promise<Availability>;
  /** Fresh cached status, or `unknown` when nothing fresh is known. Never probes. */
  peek(client: DecideClient, key: string | undefined): Availability;
  /** Demote after a live 404 so the next compaction skips the backend. */
  reportNotFound(client: DecideClient, key: string | undefined): void;
}

export function createAvailabilityCache(
  ttlMs: number = DECISIONS_AVAILABILITY_TTL_MS,
  now: () => number = Date.now,
): AvailabilityCache {
  const cached = new Map<string, { status: Availability; at: number }>();
  const cacheKey = (client: DecideClient, key: string | undefined): string =>
    `${client.id}:${fingerprintKey(key)}`;
  const fresh = (client: DecideClient, key: string | undefined): Availability | undefined => {
    const hit = cached.get(cacheKey(client, key));
    if (hit && hit.status !== "unknown" && now() - hit.at < ttlMs) return hit.status;
    return undefined;
  };
  return {
    peek: (client, key) => fresh(client, key) ?? "unknown",
    check: async (client, key) => {
      const hit = cached.get(cacheKey(client, key));
      if (hit && hit.status !== "unknown" && now() - hit.at < ttlMs) return hit.status;
      const status = await client.check().catch((): Availability => "unknown");
      if (status !== "unknown") cached.set(cacheKey(client, key), { status, at: now() });
      else cached.delete(cacheKey(client, key));
      return status;
    },
    reportNotFound: (client, key) => {
      cached.set(cacheKey(client, key), { status: "unavailable", at: now() });
    },
  };
}
