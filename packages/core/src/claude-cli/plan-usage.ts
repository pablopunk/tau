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

/** Owner A. Frozen signature; the body is a placeholder that never has usage. */
export interface PlanUsage {
  current(): ClaudeCliUsage | null;
  /** Updates the in-memory usage and calls `onChange`. */
  record(info: RateLimitInfo): void;
}

export interface PlanUsageDeps {
  readonly clock: ClaudeCliClock;
  readonly onChange: () => void;
}

export function createPlanUsage(_deps: PlanUsageDeps): PlanUsage {
  return { current: () => null, record: () => undefined };
}
