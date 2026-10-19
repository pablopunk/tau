/** Silence after which an established link no longer defends its place against a second `tau connect`. */
export const STALE_LINK_MS = 15_000;
/** The acceptor's half-open link detection (MVP13 "Glare and duplicates"). */
export const HALF_OPEN_MS = 45_000;

export const CLOSE_GOING_AWAY = 1001;
export const CLOSE_DUPLICATE = 4002;

/** What the arbiter knows about one link to a given `nodeId`, after the handshake. */
export interface LinkFacts {
  /** `accepted`: a peer dialled us (a node device). `dialled`: we dialled it (a `peers.json` entry). */
  readonly direction: "accepted" | "dialled";
  /** `nodeId` of whoever dialled this link. */
  readonly diallerId: string;
  /** Identifies the device secret used (`sha256` hex): two links with equal values are one device. */
  readonly secretKey: string;
  /** Milliseconds since the last frame; 0 for a link that has just opened. */
  readonly silentMs: number;
}

export type DuplicateCase = "reconnect" | "second-device" | "glare" | "stale-replaced";

export interface DuplicateVerdict {
  readonly case: DuplicateCase;
  readonly survivor: "existing" | "incoming";
  /** Close code for the loser; 4002 is never retried, 1001 is. */
  readonly loserCode: typeof CLOSE_GOING_AWAY | typeof CLOSE_DUPLICATE;
  /**
   * Revoke the loser's device (accepted) or delete its `peers.json` entry (dialled).
   * `false` keeps its secret as a standby.
   */
  readonly revokeLoser: boolean;
}

/**
 * Two links to the same `nodeId` (after the handshake both ends know both ids). Pure: both ends
 * run it on facts they share, so glare resolves the same way on both sides without talking.
 * (a) same device secret: the newer link replaces the older. (c) one accepted + one dialled link:
 * glare, the link whose dialler has the lower `nodeId` survives and neither device is revoked.
 * (b) two accepted (or two dialled) links with different secrets: the established one survives
 * unless it has been silent for over STALE_LINK_MS; the loser's device is revoked.
 */
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
