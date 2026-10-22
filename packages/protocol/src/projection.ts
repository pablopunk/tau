import { Value } from "typebox/value";
import {
  SUBAGENT_NOTIFICATION_KIND,
  type SubagentNotificationData,
  SubagentNotificationDataSchema,
  type ThinkingLevel,
} from "./entities";
import {
  BANG_KIND,
  type BangData,
  BangDataSchema,
  GOAL_VERDICT_KIND,
  type GoalVerdictData,
  GoalVerdictDataSchema,
  isNotificationText,
  MONITOR_EVENT_KIND,
  type MonitorEventData,
  MonitorEventDataSchema,
  NOTICE_KIND,
  type NoticeData,
  NoticeDataSchema,
  PROCESS_EXIT_KIND,
  type ProcessExitData,
  ProcessExitDataSchema,
  TIMER_FIRED_KIND,
  type TimerFiredData,
  TimerFiredDataSchema,
} from "./mvp8";
import { latestTodoSource, latestTodos, type TodoItem } from "./todos";
import type {
  AgentState,
  AssistantMessage,
  ConversationView,
  EntryRecord,
  ImageContent,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from "./view";

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

export interface TodosProjection {
  readonly items: TodoItem[];
  readonly source: string | undefined;
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

export function todosProjectionOf(view: ConversationView): TodosProjection {
  return { items: latestTodos(view), source: latestTodoSource(view) };
}

export interface ToolDiagnostic {
  readonly severity: string;
  readonly message: string;
  readonly code?: string;
}

export interface ToolResultInfo {
  readonly message: ToolResultMessage;
  readonly diagnostics: readonly ToolDiagnostic[];
}

/** The transcript items that MVP8 notification entries turn into, one per kind. */
export type MvpNotificationItem =
  | { readonly kind: "monitor-event"; readonly data: MonitorEventData }
  | { readonly kind: "process-exit"; readonly data: ProcessExitData }
  | { readonly kind: "timer-fired"; readonly data: TimerFiredData }
  | { readonly kind: "notice"; readonly data: NoticeData }
  | { readonly kind: "goal-verdict"; readonly data: GoalVerdictData }
  | { readonly kind: "bang"; readonly data: BangData };

export type TranscriptItem =
  | {
      readonly kind: "user";
      readonly key: string;
      readonly entryId: string;
      readonly text: string;
      readonly images: readonly ImageContent[];
    }
  | { readonly kind: "retry"; readonly key: string }
  | { readonly kind: "compaction"; readonly key: string }
  | { readonly kind: "subagent-notification"; readonly key: string; readonly data: SubagentNotificationData }
  | (MvpNotificationItem & { readonly key: string })
  | {
      readonly kind: "assistant";
      readonly key: string;
      readonly entryId: string;
      readonly message: AssistantMessage;
    };

export interface Transcript {
  readonly items: readonly TranscriptItem[];
  readonly results: ReadonlyMap<string, ToolResultInfo>;
}

export const isSubagentNotificationKind = (kind: string): boolean => kind === SUBAGENT_NOTIFICATION_KIND;

export function parseSubagentNotification(data: unknown): SubagentNotificationData | undefined {
  return Value.Check(SubagentNotificationDataSchema, data) ? data : undefined;
}

const mvpNotificationParsers = {
  [BANG_KIND]: (data: unknown): MvpNotificationItem | undefined =>
    Value.Check(BangDataSchema, data) ? { kind: "bang", data } : undefined,
  [MONITOR_EVENT_KIND]: (data: unknown): MvpNotificationItem | undefined =>
    Value.Check(MonitorEventDataSchema, data) ? { kind: "monitor-event", data } : undefined,
  [PROCESS_EXIT_KIND]: (data: unknown): MvpNotificationItem | undefined =>
    Value.Check(ProcessExitDataSchema, data) ? { kind: "process-exit", data } : undefined,
  [TIMER_FIRED_KIND]: (data: unknown): MvpNotificationItem | undefined =>
    Value.Check(TimerFiredDataSchema, data) ? { kind: "timer-fired", data } : undefined,
  [NOTICE_KIND]: (data: unknown): MvpNotificationItem | undefined =>
    Value.Check(NoticeDataSchema, data) ? { kind: "notice", data } : undefined,
  [GOAL_VERDICT_KIND]: (data: unknown): MvpNotificationItem | undefined =>
    Value.Check(GoalVerdictDataSchema, data) ? { kind: "goal-verdict", data } : undefined,
} as const;

export function parseMvpNotification(entryKind: string, data: unknown): MvpNotificationItem | undefined {
  const parse = (
    mvpNotificationParsers as Record<string, (data: unknown) => MvpNotificationItem | undefined>
  )[entryKind];
  return parse?.(data);
}

function isImage(block: TextContent | ImageContent): block is ImageContent {
  return block.type === "image";
}

function isText(block: TextContent | ImageContent): block is TextContent {
  return block.type === "text";
}

export function userText(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter(isText)
    .map((block) => block.text)
    .join("\n");
}

export function userImages(message: UserMessage): readonly ImageContent[] {
  return typeof message.content === "string" ? [] : message.content.filter(isImage);
}

function diagnosticsOf(entry: EntryRecord): readonly ToolDiagnostic[] {
  const data = entry.data as { diagnostics?: readonly ToolDiagnostic[] } | undefined;
  return data?.diagnostics ?? [];
}

function entryKey(entry: EntryRecord): string {
  return `${entry.kind}:${entry.id}`;
}

function notificationItemOf(entry: EntryRecord): TranscriptItem | undefined {
  const mvp = parseMvpNotification(entry.kind, entry.data);
  if (mvp) return { ...mvp, key: entryKey(entry) };
  if (!isSubagentNotificationKind(entry.kind)) return undefined;
  const data = parseSubagentNotification(entry.data);
  return data ? { kind: "subagent-notification", key: entryKey(entry), data } : undefined;
}

function transcriptItemOf(entry: EntryRecord): TranscriptItem | undefined {
  const message = entry.model?.[0];
  const notification = notificationItemOf(entry);
  if (notification) return notification;
  if (entry.kind === "pi.user" && message?.role === "user") {
    if (isNotificationText(userText(message))) return undefined;
    return {
      kind: "user",
      key: entryKey(entry),
      entryId: String(entry.id),
      text: userText(message),
      images: userImages(message),
    };
  }
  if (entry.kind === "pi.compaction") return { kind: "compaction", key: entryKey(entry) };
  if (entry.kind === "app.retry") return { kind: "retry", key: entryKey(entry) };
  if (entry.kind === "pi.assistant" && message?.role === "assistant") {
    return { kind: "assistant", key: entryKey(entry), entryId: String(entry.id), message };
  }
  return undefined;
}

function toolResultOf(entry: EntryRecord): [string, ToolResultInfo] | undefined {
  const message = entry.model?.[0];
  if (entry.kind !== "pi.tool-result" || message?.role !== "toolResult") return undefined;
  return [message.toolCallId, { message, diagnostics: diagnosticsOf(entry) }];
}

/** `pi.system` entries and the head marker are bookkeeping and never shown. */
export function transcriptOf(view: ConversationView): Transcript {
  const items: TranscriptItem[] = [];
  const results = new Map<string, ToolResultInfo>();
  for (const entry of view.entries) {
    const item = transcriptItemOf(entry);
    if (item) items.push(item);
    const result = toolResultOf(entry);
    if (result) results.set(result[0], result[1]);
  }
  return { items, results };
}
