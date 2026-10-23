import { type ConversationView, type NativeEvent, nativeEventsOf } from "@tau/protocol";

const LINE_LIMIT = 80;
const UNKNOWN_OUTCOME_MESSAGE = "the run's outcome is unknown; check the workspace";
const NOTABLE_LIFECYCLES: readonly string[] = [
  "blocked",
  "failed",
  "cancelled",
  "interrupted",
  "outcome-unknown",
];

type Lifecycle = Extract<NativeEvent, { type: "lifecycle" }>;
type TextEvent = Extract<NativeEvent, { type: "assistant-text" }>;

export const nativeUnknownOutcomeMessage = (): string => UNKNOWN_OUTCOME_MESSAGE;

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

const truncate = (text: string): string =>
  text.length <= LINE_LIMIT ? text : `${text.slice(0, LINE_LIMIT - 1)}…`;

const toolCallLine = (event: Extract<NativeEvent, { type: "tool-call" }>): string =>
  `  > ${event.name} ${truncate(JSON.stringify(event.input ?? {}))}`;

const toolResultLine = (event: Extract<NativeEvent, { type: "tool-result" }>): string => {
  const text = truncate(oneLine(event.text));
  return `  < ${event.isError ? `error: ${text}` : text}`.trimEnd();
};

function lifecycleLines(event: Lifecycle, verbose: boolean): string[] {
  if (!verbose && !NOTABLE_LIFECYCLES.includes(event.lifecycle)) return [];
  const reason = event.reason ? ` ${oneLine(event.reason)}` : "";
  return [`[${event.lifecycle.replace("-", " ")}]${reason}`];
}

/** Lines for one event. Assistant text is `assistant: ...`, tool calls `  > name args`, results `  < text`. */
export function nativeEventLines(event: NativeEvent, verbose: boolean): string[] {
  switch (event.type) {
    case "user":
      return [`user: ${event.text.trim()}`];
    case "assistant-text":
      return event.text.trim() ? [`assistant: ${event.text.trim()}`] : [];
    case "tool-call":
      return [toolCallLine(event)];
    case "tool-result":
      return [toolResultLine(event)];
    case "lifecycle":
      return lifecycleLines(event, verbose);
    case "notice":
      return [`notice: ${oneLine(event.text)}`];
    case "result":
      return event.isError ? [`error: ${oneLine(event.text ?? event.subtype)}`] : [];
    default:
      return [];
  }
}

/** One group of lines per message: assistant text and its tool calls stay together, like Pi. */
function messagesOf(events: readonly NativeEvent[]): string[][] {
  const messages: string[][] = [];
  let texts: string[] = [];
  let tools: string[] = [];
  const flush = () => {
    if (texts.length > 0 || tools.length > 0)
      messages.push([...(texts.length > 0 ? [`assistant: ${texts.join("\n")}`] : []), ...tools]);
    texts = [];
    tools = [];
  };
  for (const event of events) {
    if (event.type === "assistant-text") {
      if (event.text.trim()) texts.push(event.text.trim());
      continue;
    }
    if (event.type === "tool-call") {
      tools.push(toolCallLine(event));
      continue;
    }
    const lines = nativeEventLines(event, false);
    if (lines.length === 0) continue;
    flush();
    messages.push(lines);
  }
  flush();
  return messages;
}

/** The native transcript as plain text, in the same format as Pi. `last` keeps the final N messages. */
export function nativeViewToText(view: ConversationView, options: { readonly last?: number } = {}): string {
  const messages = messagesOf(nativeEventsOf(view));
  const kept = options.last === undefined ? messages : messages.slice(-options.last);
  return kept.map((lines) => lines.join("\n")).join("\n\n");
}

const isText = (event: NativeEvent): event is TextEvent => event.type === "assistant-text";

/** The final assistant message of the last operation (after the last user message), or an empty string. */
export function nativeAnswerOf(view: ConversationView): string {
  const events = nativeEventsOf(view);
  const operation = events.slice(events.findLastIndex((event) => event.type === "user") + 1);
  const texts = operation.filter(isText).filter((event) => event.text.trim());
  const last = texts.at(-1);
  if (last) {
    const sameMessage = texts.filter((event) => event.messageId === last.messageId);
    return sameMessage.map((event) => event.text.trim()).join("\n");
  }
  const result = operation.findLast((event) => event.type === "result" && !event.isError);
  return result?.type === "result" ? (result.text?.trim() ?? "") : "";
}

const latestNoticeOf = (events: readonly NativeEvent[]): string | undefined => {
  const notice = events.findLast((event) => event.type === "notice");
  return notice?.type === "notice" ? oneLine(notice.text) : undefined;
};

const latestLifecycleReasonOf = (events: readonly NativeEvent[], lifecycle: string): string | undefined => {
  const found = events.findLast((event) => event.type === "lifecycle" && event.lifecycle === lifecycle);
  return found?.type === "lifecycle" ? found.reason : undefined;
};

/** Why a blocked run waits: the latest notice, else the lifecycle reason. */
export function nativeBlockedMessageOf(view: ConversationView): string {
  const events = nativeEventsOf(view);
  const reason = latestNoticeOf(events) ?? latestLifecycleReasonOf(events, "blocked");
  return `the run is blocked${reason ? `: ${reason}` : ""}`;
}

/** Why a native run failed: the error result, else the failed reason, else the latest notice. */
export function nativeErrorMessageOf(view: ConversationView): string {
  const events = nativeEventsOf(view);
  const result = events.findLast((event) => event.type === "result" && event.isError);
  if (result?.type === "result") return oneLine(result.text ?? result.subtype);
  return latestLifecycleReasonOf(events, "failed") ?? latestNoticeOf(events) ?? "the run failed";
}

export const nativeEntriesWithoutExecutorMessage = (conversationId: string): string =>
  `unsupported: thread ${conversationId} has native entries but its summary names no executor; refusing to read it as Pi`;

export const hasNativeEntries = (view: ConversationView): boolean => nativeEventsOf(view).length > 0;

export interface NativeLineCursor {
  /** Lines of events not seen before; keys already taken, including across reconnects, add nothing. */
  take(view: ConversationView): string[];
}

export function createNativeLineCursor(): NativeLineCursor {
  const seen = new Set<string>();
  return {
    take(view) {
      const fresh = nativeEventsOf(view).filter((event) => !seen.has(event.key));
      for (const event of fresh) seen.add(event.key);
      return fresh.flatMap((event) => nativeEventLines(event, true));
    },
  };
}
