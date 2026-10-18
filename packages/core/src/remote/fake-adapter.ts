import { REMOTE_OFF, type RemoteStatus } from "@tau/protocol";
import type { RemoteAdapter } from "./ports";

export interface FakeRemoteAdapter extends RemoteAdapter {
  /** Sets the status as the tunnel would (offline, reconnecting…). */
  push(status: Partial<RemoteStatus>): void;
}

/** A tunnel that never leaves the process: hostnames are `fake-<n>.tunnel.test`. */
export function createFakeRemoteAdapter(now: () => number = Date.now): FakeRemoteAdapter {
  let current: RemoteStatus = REMOTE_OFF;
  let counter = 0;
  const listeners = new Set<(status: RemoteStatus) => void>();
  const set = (next: RemoteStatus) => {
    current = next;
    for (const listener of [...listeners]) listener(current);
    return current;
  };
  const online = (): RemoteStatus => ({
    ...REMOTE_OFF,
    state: "online",
    url: `https://fake-${++counter}.tunnel.test`,
    since: now(),
  });
  return {
    status: () => current,
    enable: async () => set(current.url ? { ...current, state: "online", since: now() } : online()),
    disable: async () => set(REMOTE_OFF),
    recreate: async () => set(online()),
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push: (patch) => void set({ ...current, ...patch }),
    close: async () => void listeners.clear(),
  };
}
