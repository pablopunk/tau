const PEER_FAILURE_LIMIT = 5;
const PEER_WINDOW_MS = 60_000;
const PEER_LOCK_MS = 10 * 60_000;
const GLOBAL_FAILURE_LIMIT = 100;

interface Bucket {
  failures: number[];
  lockedUntil: number;
}

const LOCAL = "local";

/** IPv6 collapses to its /64; loopback and missing addresses share one bucket. */
export function peerBucket(peer: string): string {
  const address =
    peer
      .trim()
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .split("%")[0] ?? "";
  if (address === "" || address === "local" || address === "::1" || address.startsWith("127.")) return LOCAL;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped?.[1]) return mapped[1] === "127.0.0.1" ? LOCAL : mapped[1];
  if (!address.includes(":")) return address;
  return `${expandIpv6(address).slice(0, 4).join(":")}::/64`;
}

function expandIpv6(address: string): string[] {
  const [head = "", tail] = address.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const fill = tail === undefined ? 0 : Math.max(0, 8 - left.length - right.length);
  return [...left, ...Array<string>(fill).fill("0"), ...right].map((group) => group.padStart(4, "0"));
}

/** Failures never burn codes; they only lock peers (and, past a backstop, short-code redeem). */
export function createRedeemLimits(now: () => number) {
  const peers = new Map<string, Bucket>();
  const global: Bucket = { failures: [], lockedUntil: 0 };
  const record = (bucket: Bucket, limit: number) => {
    bucket.failures = [...bucket.failures.filter((at) => now() - at < PEER_WINDOW_MS), now()];
    if (bucket.failures.length >= limit) bucket.lockedUntil = now() + PEER_LOCK_MS;
  };
  return {
    peerLocked: (peer: string) => (peers.get(peerBucket(peer))?.lockedUntil ?? 0) > now(),
    shortCodesLocked: () => global.lockedUntil > now(),
    recordFailure(peer: string) {
      const key = peerBucket(peer);
      const bucket = peers.get(key) ?? { failures: [], lockedUntil: 0 };
      record(bucket, PEER_FAILURE_LIMIT);
      peers.set(key, bucket);
      record(global, GLOBAL_FAILURE_LIMIT);
    },
  };
}
