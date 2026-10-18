import { MAX_LIVE_PAIRINGS, PAIRING_TTL_MS, type PairingKind } from "@tau/protocol";
import { safeEqual } from "./secrets";

const SHORT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface LivePairing {
  readonly kind: PairingKind;
  readonly code: string;
  readonly shortCode: string;
  readonly expiresAt: number;
}

export function newShortCode(random: (size: number) => Buffer): string {
  return [...random(8)].map((byte) => SHORT_ALPHABET[byte % SHORT_ALPHABET.length]).join("");
}

export const looksLikeShortCode = (input: string) =>
  /^[A-Za-z0-9]{8}$/.test(input) && !/^[0-9a-f]{32}$/i.test(input);

/** The in-memory set of live codes: five at most, five minutes, single use. */
export function createPairingCodes(now: () => number, random: (size: number) => Buffer) {
  let live: LivePairing[] = [];
  const prune = () => {
    live = live.filter((entry) => entry.expiresAt > now());
  };
  return {
    mint(kind: PairingKind): LivePairing {
      prune();
      const entry = {
        kind,
        code: random(16).toString("hex"),
        shortCode: newShortCode(random),
        expiresAt: now() + PAIRING_TTL_MS,
      };
      live = [...live, entry].slice(-MAX_LIVE_PAIRINGS);
      return entry;
    },
    /** Checks every live code (no early exit); the match is removed. */
    take(input: string): LivePairing | undefined {
      prune();
      const long = input.trim().toLowerCase();
      const short = input.trim().toUpperCase();
      let found: LivePairing | undefined;
      for (const entry of live) {
        const hitLong = safeEqual(entry.code, long);
        const hitShort = safeEqual(entry.shortCode, short);
        if (hitLong || hitShort) found = entry;
      }
      if (found) live = live.filter((entry) => entry !== found);
      return found;
    },
    clear() {
      live = [];
    },
  };
}
