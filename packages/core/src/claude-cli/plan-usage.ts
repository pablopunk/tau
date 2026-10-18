import type { ClaudeCliUsage } from "@tau/protocol";
import type { ClaudeCliClock } from "./clock";

/** The `rate_limit_info` of an SDK `rate_limit_event`. */
export interface RateLimitInfo {
  readonly status: ClaudeCliUsage["status"];
  readonly rateLimitType?: string;
  readonly utilization?: number;
  readonly resetsAt?: number;
  readonly unifiedWindows?: { readonly five_hour?: { readonly utilization?: number } };
}

export interface PlanUsage {
  current(): ClaudeCliUsage | null;
  /** Updates the in-memory usage and calls `onChange`. */
  record(info: RateLimitInfo): void;
}

export interface PlanUsageDeps {
  readonly clock: ClaudeCliClock;
  readonly onChange: () => void;
}

const fiveHourUtilization = (info: RateLimitInfo): number | undefined =>
  info.unifiedWindows?.five_hour?.utilization ??
  (info.rateLimitType === "five_hour" ? info.utilization : undefined);

export function createPlanUsage(deps: PlanUsageDeps): PlanUsage {
  let usage: ClaudeCliUsage | null = null;
  return {
    current: () => usage,
    record(info) {
      usage = {
        status: info.status,
        fiveHour: fiveHourUtilization(info) ?? usage?.fiveHour ?? null,
        resetsAt: info.resetsAt ?? usage?.resetsAt ?? null,
        updatedAt: deps.clock.now(),
      };
      deps.onChange();
    },
  };
}
