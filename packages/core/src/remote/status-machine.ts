import { REMOTE_OFF, type RemoteState, type RemoteStatus } from "@tau/protocol";
import { RECREATE_TEXT, STARTING_TEXT } from "./neutral-text";

export const RECREATE_AFTER_MS = 10 * 60 * 1000;

export type Schedule = (run: () => void, ms: number) => () => void;

export const timeoutSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  timer.unref();
  return () => clearTimeout(timer);
};

export interface StatusMachine {
  status(): RemoteStatus;
  onStatus(listener: (status: RemoteStatus) => void): () => void;
  set(state: RemoteState, patch?: { url?: string | null; message?: string | null }): void;
  setPendingRemoval(pending: boolean): void;
}

/**
 * `off | starting | online | reconnecting | error` with URL, `since` and a neutral message. Leaving `online` starts
 * a 10 minute timer; when it fires while still not online, the status says so and offers a new URL.
 */
export function createStatusMachine(now: () => number, schedule: Schedule = timeoutSchedule): StatusMachine {
  let current: RemoteStatus = REMOTE_OFF;
  let cancelTimer: (() => void) | undefined;
  const listeners = new Set<(status: RemoteStatus) => void>();
  const publish = (next: RemoteStatus) => {
    current = next;
    for (const listener of [...listeners]) listener(current);
  };
  const offlineStates: RemoteState[] = ["reconnecting", "error"];
  const armRecreateTimer = () => {
    cancelTimer?.();
    cancelTimer = schedule(() => {
      if (!offlineStates.includes(current.state)) return;
      publish({ ...current, canRecreate: true, message: RECREATE_TEXT });
    }, RECREATE_AFTER_MS);
  };
  return {
    status: () => current,
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(state, patch = {}) {
      const keepsOfflineClock = offlineStates.includes(state) && offlineStates.includes(current.state);
      if (offlineStates.includes(state) && !keepsOfflineClock) armRecreateTimer();
      if (!offlineStates.includes(state)) cancelTimer?.();
      const canRecreate = keepsOfflineClock && current.canRecreate;
      const message = patch.message ?? (state === "starting" ? STARTING_TEXT : null);
      const url = patch.url === undefined ? (state === "off" ? null : current.url) : patch.url;
      const since = state === current.state && current.since !== null ? current.since : now();
      publish({
        ...current,
        state,
        url,
        since: state === "off" ? null : since,
        message: canRecreate && patch.message === undefined ? RECREATE_TEXT : message,
        canRecreate,
      });
    },
    setPendingRemoval(pending) {
      if (pending !== current.pendingRemoval) publish({ ...current, pendingRemoval: pending });
    },
  };
}
