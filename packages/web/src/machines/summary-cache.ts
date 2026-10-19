import type { MachineSummary } from "@tau/protocol";
import { machineKey } from "@/lib/machine-keys";

const KEY = "tau:machine-summary";

const isSummary = (value: unknown): value is MachineSummary =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as MachineSummary).projects) &&
  Array.isArray((value as MachineSummary).threads);

/** What this browser last saw of a machine while it was online: titles and times only, never transcripts. */
export function readSummaryCache(machineId: string): MachineSummary | undefined {
  try {
    const raw = window.localStorage.getItem(machineKey(KEY, machineId));
    const value: unknown = raw ? JSON.parse(raw) : undefined;
    return isSummary(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeSummaryCache(machineId: string, summary: MachineSummary): void {
  try {
    window.localStorage.setItem(machineKey(KEY, machineId), JSON.stringify(summary));
  } catch {
    // Storage unavailable or full: an offline machine just shows no cached threads.
  }
}

export function forgetSummaryCache(machineId: string): void {
  try {
    window.localStorage.removeItem(machineKey(KEY, machineId));
  } catch {
    // Nothing to forget.
  }
}
