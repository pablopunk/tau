import type {
  AssistantMessage,
  ConversationView,
  EntryRecord,
  ImageContent,
  SubagentNotificationData,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from "@tau/protocol";
import {
  isNotificationMarkerText,
  isSubagentNotificationKind,
  type MvpNotificationItem,
  parseMvpNotification,
  parseSubagentNotification,
} from "../notifications/notification-entry";

export interface ToolDiagnostic {
  readonly severity: string;
  readonly message: string;
  readonly code?: string;
}

export interface ToolResultInfo {
  readonly message: ToolResultMessage;
  readonly diagnostics: readonly ToolDiagnostic[];
}

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

function itemOf(entry: EntryRecord): TranscriptItem | undefined {
  const message = entry.model?.[0];
  const notification = notificationItemOf(entry);
  if (notification) return notification;
  if (entry.kind === "pi.user" && message?.role === "user") {
    if (isNotificationMarkerText(userText(message))) return undefined;
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

function resultOf(entry: EntryRecord): [string, ToolResultInfo] | undefined {
  const message = entry.model?.[0];
  if (entry.kind !== "pi.tool-result" || message?.role !== "toolResult") return undefined;
  return [message.toolCallId, { message, diagnostics: diagnosticsOf(entry) }];
}

/** `pi.system` entries and the head marker are bookkeeping and never shown. */
export function buildTranscript(view: ConversationView): Transcript {
  const items: TranscriptItem[] = [];
  const results = new Map<string, ToolResultInfo>();
  for (const entry of view.entries) {
    const item = itemOf(entry);
    if (item) items.push(item);
    const result = resultOf(entry);
    if (result) results.set(result[0], result[1]);
  }
  return { items, results };
}
