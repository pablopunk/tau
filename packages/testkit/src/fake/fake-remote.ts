import { AppError, type Change, type Core, REMOTE_OFF, type RemoteStatus } from "@tau/protocol";
import type { FakeAccess } from "./fake-access";

export interface FakeRemote {
  readonly api: Core["remote"];
  readonly status: () => RemoteStatus;
  /** Plays what the tunnel would do: `{ state: "reconnecting", canRecreate: true }`, an error, … */
  push(patch: Partial<RemoteStatus>): void;
}

export interface FakeRemoteOptions {
  readonly now: () => number;
  readonly emit: (change: Change) => void;
  readonly access: Pick<FakeAccess, "clearAll">;
  /** Start with remote on (the Settings the user saved). */
  readonly enabled?: boolean;
}

/** A tunnel that never leaves the process. Hostnames are `fake-<n>.tunnel.test` and stay until off or recreate. */
export function createFakeRemote({ now, emit, access, enabled = false }: FakeRemoteOptions): FakeRemote {
  let counter = 0;
  const online = (): RemoteStatus => ({
    ...REMOTE_OFF,
    state: "online",
    url: `https://fake-${++counter}.tunnel.test`,
    since: now(),
  });
  let current: RemoteStatus = enabled ? online() : REMOTE_OFF;
  const set = (next: RemoteStatus) => {
    current = next;
    emit({ resource: "remote" });
    return current;
  };
  return {
    status: () => current,
    push: (patch) => void set({ ...current, ...patch }),
    api: {
      status: async () => current,
      enable: async () => (current.state === "off" ? set(online()) : current),
      async disable() {
        await access.clearAll();
        return set(REMOTE_OFF);
      },
      async recreate() {
        if (!current.canRecreate) {
          throw new AppError("invalid_request", "The URL can only be replaced after 10 minutes offline.");
        }
        await access.clearAll();
        return set(online());
      },
    },
  };
}
