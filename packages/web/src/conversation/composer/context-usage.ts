import type { EntryRecord } from "@pi-everywhere/protocol";

export interface ContextUsage {
  readonly used: number;
  readonly total: number;
  readonly label: string;
}

interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
}

const CHARS_PER_TOKEN = 4;

function usageOf(entry: EntryRecord): Usage | undefined {
  if (entry.kind !== "pi.assistant") return undefined;
  return (entry.model?.[0] as { usage?: Usage } | undefined)?.usage;
}

function tokensOf(usage: Usage): number {
  if ((usage.totalTokens ?? 0) > 0) return usage.totalTokens ?? 0;
  return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) + (usage.output ?? 0);
}

function entryChars(entry: EntryRecord): number {
  return (entry.model ?? []).reduce((sum, message) => sum + JSON.stringify(message.content ?? "").length, 0);
}

function entriesAfterLatestCompactionHead(entries: readonly EntryRecord[]): readonly EntryRecord[] {
  const compactionAt = entries.findLastIndex((entry) => entry.kind === "pi.compaction");
  if (compactionAt < 0) return entries;
  const head = String((entries[compactionAt] as { head?: unknown }).head);
  const headAt = entries.findIndex((entry, index) => index > compactionAt && String(entry.id) === head);
  return entries.slice(headAt >= 0 ? headAt : compactionAt + 1);
}

export function formatTokens(count: number): string {
  return count >= 1000 ? `${Math.round(count / 1000)}k` : String(count);
}

export function usageLabel(used: number, total: number): string {
  const percent = Math.round((used / total) * 100);
  return `${formatTokens(used)} of ${formatTokens(total)} tokens · ${percent}%`;
}

export function contextUsage(entries: readonly EntryRecord[], contextWindow: number): ContextUsage | null {
  if (contextWindow <= 0) return null;
  const live = entriesAfterLatestCompactionHead(entries);
  const lastAt = live.findLastIndex((entry) => usageOf(entry) !== undefined);
  if (lastAt < 0) return null;
  const usage = usageOf(live[lastAt] as EntryRecord) as Usage;
  const later = live.slice(lastAt + 1).reduce((sum, entry) => sum + entryChars(entry), 0);
  const used = tokensOf(usage) + Math.ceil(later / CHARS_PER_TOKEN);
  return { used, total: contextWindow, label: usageLabel(used, contextWindow) };
}
