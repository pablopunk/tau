import type {
  AssistantMessage,
  ConversationView,
  EntryRecord,
  ImageContent,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from "@pi-everywhere/protocol";

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
  | { readonly kind: "user"; readonly key: string; readonly text: string }
  | { readonly kind: "assistant"; readonly key: string; readonly message: AssistantMessage };

export interface Transcript {
  readonly items: readonly TranscriptItem[];
  readonly results: ReadonlyMap<string, ToolResultInfo>;
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

function diagnosticsOf(entry: EntryRecord): readonly ToolDiagnostic[] {
  const data = entry.data as { diagnostics?: readonly ToolDiagnostic[] } | undefined;
  return data?.diagnostics ?? [];
}

function entryKey(entry: EntryRecord): string {
  return `${entry.kind}:${entry.id}`;
}

function itemOf(entry: EntryRecord): TranscriptItem | undefined {
  const message = entry.model?.[0];
  if (entry.kind === "pi.user" && message?.role === "user") {
    return { kind: "user", key: entryKey(entry), text: userText(message) };
  }
  if (entry.kind === "pi.assistant" && message?.role === "assistant") {
    return { kind: "assistant", key: entryKey(entry), message };
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
