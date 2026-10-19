export interface SetupGateInput {
  /** A provider is connected and a default model is chosen: this node can run threads. */
  readonly canRunThreads: boolean;
  /** `Settings.setupSkipped`: the user chose "Use my other nodes" (server-side). */
  readonly setupSkipped: boolean;
  /** Peers this node knows, linked now or not: a peer dropping must not swap the app back to setup mid-use. */
  readonly knownPeers: number;
}

/**
 * The onboarding gate of `app/App.tsx`: setup shows while this node cannot run threads, unless the user skipped it
 * AND at least one peer is known. It depends on the flag and on "any known peer", never on a peer's state; with no
 * peer left, setup shows again.
 */
export function needsSetup({ canRunThreads, setupSkipped, knownPeers }: SetupGateInput): boolean {
  if (canRunThreads) return false;
  return !(setupSkipped && knownPeers > 0);
}

/** "Use my other nodes" is offered when any peer is known, online or not. */
export const canUseOtherNodes = (knownPeers: number): boolean => knownPeers > 0;
