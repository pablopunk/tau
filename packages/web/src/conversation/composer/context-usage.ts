import type { ContextUsageInput } from "@tau/protocol";

export interface ContextUsage {
  readonly used: number;
  readonly total: number;
  readonly label: string;
}

const CHARS_PER_TOKEN = 4;

export function formatTokens(count: number): string {
  return count >= 1000 ? `${Math.round(count / 1000)}k` : String(count);
}

export function usageLabel(used: number, total: number): string {
  const percent = Math.round((used / total) * 100);
  return `${formatTokens(used)} of ${formatTokens(total)} tokens · ${percent}%`;
}

export function contextUsage(
  input: ContextUsageInput | undefined,
  contextWindow: number,
): ContextUsage | null {
  if (contextWindow <= 0 || !input) return null;
  const used = input.usageTokens + Math.ceil(input.charsAfter / CHARS_PER_TOKEN);
  return { used, total: contextWindow, label: usageLabel(used, contextWindow) };
}
