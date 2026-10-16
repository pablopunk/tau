import type {
  AssistantMessage,
  ConversationView,
  InboxItem,
  InboxState,
  LiveState,
  ToolSlot,
} from "@pi-everywhere/protocol";

export interface RetryInfo {
  readonly attempt: number;
  readonly at: number;
  readonly error: string;
}

export interface QueuedMessage {
  readonly id: number;
  readonly mode: "steer" | "followUp";
  readonly text: string;
}

export interface LiveInfo {
  readonly busy: boolean;
  readonly streaming: AssistantMessage | undefined;
  readonly retry: RetryInfo | undefined;
  readonly slots: readonly ToolSlot[];
  readonly queued: readonly QueuedMessage[];
}

function docOf<T>(view: ConversationView, kind: string): T | undefined {
  return view.docs[kind] as unknown as T | undefined;
}

type QueuedItem = Extract<InboxItem, { mode: "steer" | "followUp" }>;

function isQueuedMessage(item: InboxItem): item is QueuedItem {
  return item.mode === "steer" || item.mode === "followUp";
}

function queuedText(item: QueuedItem): string {
  const content = item.content as unknown;
  if (typeof content === "string") return content;
  const blocks = (content as { content?: unknown } | undefined)?.content;
  if (typeof blocks === "string") return blocks;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((block: { type?: string; text?: string }) => (block.type === "text" ? block.text : ""))
    .join("");
}

function queuedOf(item: QueuedItem): QueuedMessage {
  return { id: Number(item.id), mode: item.mode, text: queuedText(item) };
}

function retryOf(live: LiveState): RetryInfo | undefined {
  const generation = live.generation;
  if (!generation?.retry) return undefined;
  return { attempt: generation.attempt, ...generation.retry };
}

export function readLive(view: ConversationView): LiveInfo {
  const live = docOf<LiveState>(view, "pi.live") ?? {};
  const inbox = docOf<InboxState>(view, "pi.inbox");
  return {
    busy: live.run !== undefined,
    streaming: live.generation?.message as unknown as AssistantMessage | undefined,
    retry: retryOf(live),
    slots: (live.tools ?? []) as readonly ToolSlot[],
    queued: (inbox?.items ?? []).filter(isQueuedMessage).map(queuedOf),
  };
}
