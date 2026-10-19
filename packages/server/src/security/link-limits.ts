const FAILURE_LIMIT = 5;
const WINDOW_MS = 60_000;
const LOCK_MS = 10 * 60_000;

/** Failed node-secret checks per PROXY peer; the guard asks `locked` before it hashes anything. */
export interface LinkLimits {
  locked(peer: string): boolean;
  recordFailure(peer: string): void;
}

export function createLinkLimits(now: () => number = Date.now): LinkLimits {
  const records = new Map<string, { at: number[]; lockedUntil: number }>();
  return {
    locked: (peer) => (records.get(peer)?.lockedUntil ?? 0) > now(),
    recordFailure(peer) {
      const record = records.get(peer) ?? { at: [], lockedUntil: 0 };
      record.at = [...record.at.filter((time) => now() - time < WINDOW_MS), now()];
      if (record.at.length >= FAILURE_LIMIT) record.lockedUntil = now() + LOCK_MS;
      records.set(peer, record);
    },
  };
}
