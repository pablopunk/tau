import type { NodeSummary } from "@tau/protocol";
import { nodeKey } from "@/lib/node-keys";

const KEY = "tau:node-summary";

const isSummary = (value: unknown): value is NodeSummary =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as NodeSummary).projects) &&
  Array.isArray((value as NodeSummary).threads);

/** What this browser last saw of a node while it was online: titles and times only, never transcripts. */
export function readSummaryCache(nodeId: string): NodeSummary | undefined {
  try {
    const raw = window.localStorage.getItem(nodeKey(KEY, nodeId));
    const value: unknown = raw ? JSON.parse(raw) : undefined;
    return isSummary(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeSummaryCache(nodeId: string, summary: NodeSummary): void {
  try {
    window.localStorage.setItem(nodeKey(KEY, nodeId), JSON.stringify(summary));
  } catch {
    // Storage unavailable or full: an offline node just shows no cached threads.
  }
}

export function forgetSummaryCache(nodeId: string): void {
  try {
    window.localStorage.removeItem(nodeKey(KEY, nodeId));
  } catch {
    // Nothing to forget.
  }
}
