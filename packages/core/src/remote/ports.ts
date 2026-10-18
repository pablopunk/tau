import type { RemoteStatus } from "@tau/protocol";

/**
 * The tunnel as a port: only `opentunnel-adapter.ts` knows OpenTunnel. `enable` opens (or resumes) the tunnel and
 * forwards `@` to the tunnel listener; `disable` closes and removes it; `recreate` removes the old identity
 * (kept under a numbered profile until removed) and makes a new one.
 */
export interface RemoteAdapter {
  status(): RemoteStatus;
  enable(): Promise<RemoteStatus>;
  disable(): Promise<RemoteStatus>;
  recreate(): Promise<RemoteStatus>;
  /** Fires on every status change (state, url, message). Returns the unsubscribe. */
  onStatus(listener: (status: RemoteStatus) => void): () => void;
  close(): Promise<void>;
}

export interface RemoteAdapterDeps {
  /** `<home>/remote`: the custom OpenTunnel store, never XDG. */
  readonly directory: string;
  /** `127.0.0.1:<port>` of the tunnel listener; resolves once the server is up. */
  readonly tunnelTarget: () => Promise<string>;
  readonly now: () => number;
}
