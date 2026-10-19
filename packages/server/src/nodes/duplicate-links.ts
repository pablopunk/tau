/**
 * The rules for two links to one `nodeId`. A copy of `core/src/access/duplicate-links.ts` (the server does
 * not depend on core): keep the two in step; both have the same tests.
 */
export const STALE_LINK_MS = 15_000;

const CLOSE_GOING_AWAY = 1001;
const CLOSE_DUPLICATE = 4002;

export interface LinkFacts {
  /** `accepted`: a peer dialled us. `dialled`: we dialled it. */
  readonly direction: "accepted" | "dialled";
  /** `nodeId` of whoever dialled this link. */
  readonly diallerId: string;
  /** `sha256` hex of the device secret used: equal values are one device. */
  readonly secretKey: string;
  /** Milliseconds since the last frame; 0 for a link that has just opened. */
  readonly silentMs: number;
}

export type DuplicateCase = "reconnect" | "second-device" | "glare" | "stale-replaced";

export interface DuplicateVerdict {
  readonly case: DuplicateCase;
  readonly survivor: "existing" | "incoming";
  readonly loserCode: typeof CLOSE_GOING_AWAY | typeof CLOSE_DUPLICATE;
  /** Revoke the loser's device (accepted) or delete its `peers.json` entry (dialled); `false` keeps a standby. */
  readonly revokeLoser: boolean;
}

export function arbitrateDuplicateLink(existing: LinkFacts, incoming: LinkFacts): DuplicateVerdict {
  if (existing.secretKey === incoming.secretKey) {
    return { case: "reconnect", survivor: "incoming", loserCode: CLOSE_GOING_AWAY, revokeLoser: false };
  }
  if (existing.direction !== incoming.direction) {
    const keepExisting = existing.diallerId < incoming.diallerId;
    return {
      case: "glare",
      survivor: keepExisting ? "existing" : "incoming",
      loserCode: CLOSE_DUPLICATE,
      revokeLoser: false,
    };
  }
  if (existing.silentMs > STALE_LINK_MS) {
    return { case: "stale-replaced", survivor: "incoming", loserCode: CLOSE_GOING_AWAY, revokeLoser: true };
  }
  return { case: "second-device", survivor: "existing", loserCode: CLOSE_DUPLICATE, revokeLoser: true };
}
