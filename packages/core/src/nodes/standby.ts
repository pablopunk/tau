/** A standby entry is retried at most this often (MVP13 "Glare and duplicates"). */
export const STANDBY_RETRY_MS = 60_000;

export interface StandbyState {
  /** When the entry last tried (or was put on standby). */
  readonly lastTriedAt: number;
  /** A live link (accepted or dialled) to the same `nodeId` exists. */
  readonly liveLinkExists: boolean;
}

/** Whether the dialler may dial a standby entry now: never beside a live link, else once per minute. */
export function standbyDialDue(state: StandbyState, now: number): boolean {
  if (state.liveLinkExists) return false;
  return now - state.lastTriedAt >= STANDBY_RETRY_MS;
}
