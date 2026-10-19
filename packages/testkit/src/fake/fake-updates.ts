import type { UpdateStatus } from "@tau/protocol";
import { isBehind } from "@tau/protocol";

export interface FakeUpdatesOptions {
  readonly now: () => number;
  /** This tau's version. Default `0.0.0`. */
  readonly currentVersion?: string;
  /** What the registry answers. Default `null`: unreachable, so `status().latest` stays null. */
  readonly latest?: string | null;
}

export interface FakeUpdates {
  readonly api: { status(): Promise<UpdateStatus>; refresh(): Promise<UpdateStatus> };
  /** Changes what the next `refresh()` finds; `null` makes the registry unreachable. */
  setLatest(latest: string | null): void;
}

export function createFakeUpdates(options: FakeUpdatesOptions): FakeUpdates {
  const current = options.currentVersion ?? "0.0.0";
  let registry = options.latest ?? null;
  let known: { latest: string; checkedAt: number } | undefined;
  const snapshot = (): UpdateStatus => ({
    current,
    latest: known?.latest ?? null,
    checkedAt: known?.checkedAt ?? null,
    behind: known ? (isBehind(current, known.latest) ?? false) : false,
  });
  if (registry !== null) known = { latest: registry, checkedAt: options.now() };
  return {
    api: {
      async status() {
        return snapshot();
      },
      async refresh() {
        if (registry !== null) known = { latest: registry, checkedAt: options.now() };
        return snapshot();
      },
    },
    setLatest(latest) {
      registry = latest;
    },
  };
}
