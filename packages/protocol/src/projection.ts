import type { ThinkingLevel } from "./entities";
import type { AgentState, ConversationView, EntryRecord, ImageContent } from "./view";

export interface AgentInfo {
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: ThinkingLevel;
}

export interface ContextUsageInput {
  readonly usageTokens: number;
  readonly charsAfter: number;
}

export interface ImageRef {
  readonly entryId: string;
  /** User-attached vs read back by the agent (tool results, e.g. Read with images). */
  readonly source: "user" | "agent";
  readonly src: string;
}

export function agentInfoOf(view: ConversationView): AgentInfo {
  const agent = view.docs["pi.agent"] as unknown as Partial<AgentState> | undefined;
  return {
    provider: agent?.model?.provider,
    modelId: agent?.model?.modelId,
    thinkingLevel: (agent?.thinkingLevel as ThinkingLevel | undefined) ?? "off",
  };
}

interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
}

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

export function contextUsageInputOf(view: ConversationView): ContextUsageInput | undefined {
  const live = entriesAfterLatestCompactionHead(view.entries);
  const lastAt = live.findLastIndex((entry) => usageOf(entry) !== undefined);
  if (lastAt < 0) return undefined;
  const usage = usageOf(live[lastAt] as EntryRecord) as Usage;
  const charsAfter = live.slice(lastAt + 1).reduce((sum, entry) => sum + entryChars(entry), 0);
  return { usageTokens: tokensOf(usage), charsAfter };
}

function srcOf(image: ImageContent): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

function isImageBlock(block: unknown): block is ImageContent {
  if (typeof block !== "object" || block === null) return false;
  const candidate = block as { type?: unknown; mimeType?: unknown; data?: unknown };
  return (
    candidate.type === "image" && typeof candidate.mimeType === "string" && typeof candidate.data === "string"
  );
}

function imagesIn(content: unknown): readonly ImageContent[] {
  if (!Array.isArray(content)) return [];
  return content.filter(isImageBlock);
}

function imageSourceOf(entry: EntryRecord, role: unknown): ImageRef["source"] {
  return entry.kind === "pi.tool-result" || role !== "user" ? "agent" : "user";
}

export function imageRefsOf(view: ConversationView): readonly ImageRef[] {
  const out: ImageRef[] = [];
  for (const entry of view.entries) {
    const message = entry.model?.[0] as { role?: unknown; content?: unknown } | undefined;
    if (!message || typeof message.content === "string") continue;
    const source = imageSourceOf(entry, message.role);
    for (const image of imagesIn(message.content)) {
      out.push({ entryId: String(entry.id), source, src: srcOf(image) });
    }
  }
  return out;
}
