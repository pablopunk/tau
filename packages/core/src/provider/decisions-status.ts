import type { DecisionsAvailability, ProviderId } from "@tau/protocol";
import type { Availability } from "../decisions/client";

export const DECISIONS_STATUS_TTL_MS = 24 * 60 * 60 * 1000;

const DECISION_BACKENDS: readonly ProviderId[] = ["typesafe", "openai"];

export function isDecisionBackend(id: ProviderId): boolean {
  return DECISION_BACKENDS.includes(id);
}

export interface DecisionsStatus {
  /**
   * Cached status for the decision backends; `undefined` elsewhere. Sync and
   * read-only: kicks off a background refresh when stale but never blocks.
   */
  decisionsFor(id: ProviderId): DecisionsAvailability | undefined;
}

export function createDecisionsStatus(deps: {
  check: (id: "typesafe" | "openai") => Promise<Availability>;
  onRefreshed?: () => void;
  ttlMs?: number;
  now?: () => number;
}): DecisionsStatus {
  const ttlMs = deps.ttlMs ?? DECISIONS_STATUS_TTL_MS;
  const now = deps.now ?? Date.now;
  const cached = new Map<ProviderId, { status: DecisionsAvailability; at: number }>();
  const inFlight = new Set<ProviderId>();

  const refresh = (id: "typesafe" | "openai"): void => {
    if (inFlight.has(id)) return;
    inFlight.add(id);
    deps
      .check(id)
      .then((status: Availability) => {
        cached.set(id, { status, at: now() });
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight.delete(id);
        deps.onRefreshed?.();
      });
  };

  return {
    decisionsFor: (id) => {
      if (!isDecisionBackend(id)) return undefined;
      const backend = id as "typesafe" | "openai";
      const hit = cached.get(id);
      if (hit && now() - hit.at < ttlMs) return hit.status;
      if (inFlight.has(id)) return "checking";
      refresh(backend);
      return hit?.status ?? "unknown";
    },
  };
}
