import type {
  AssistantMessage,
  ConversationView,
  ImageContent,
  InboxItem,
  InboxState,
  LiveState,
  ToolSlot,
} from "./view";

export interface RetryInfo {
  readonly attempt: number;
  readonly at: number;
  readonly error: string;
}

export interface QueuedMessage {
  readonly id: number;
  readonly mode: "steer" | "followUp";
  readonly entryKind: string;
  readonly text: string;
  readonly images: readonly ImageContent[];
}

export interface LiveInfo {
  readonly busy: boolean;
  readonly streaming: AssistantMessage | undefined;
  readonly retry: RetryInfo | undefined;
  readonly slots: readonly ToolSlot[];
  readonly queued: readonly QueuedMessage[];
  readonly compacting: boolean;
}

function docOf<T>(view: ConversationView, kind: string): T | undefined {
  return view.docs[kind] as unknown as T | undefined;
}

type QueuedItem = Extract<InboxItem, { mode: "steer" | "followUp" }>;

function isQueuedMessage(item: InboxItem): item is QueuedItem {
  return item.mode === "steer" || item.mode === "followUp";
}

type Block = { type?: string; text?: string };

function blocksOf(content: unknown): Block[] {
  return Array.isArray(content) ? (content as Block[]) : [];
}

function queuedBlocks(item: QueuedItem): string | Block[] {
  const content = item.content as unknown;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content as Block[];
  // Tolerate a wrapped `{ content }` shape, should one ever appear.
  const wrapped = (content as { content?: unknown } | undefined)?.content;
  if (typeof wrapped === "string") return wrapped;
  return blocksOf(wrapped);
}

function queuedText(item: QueuedItem): string {
  const blocks = queuedBlocks(item);
  if (typeof blocks === "string") return blocks;
  return blocks.map((block) => (block.type === "text" ? block.text : "")).join("");
}

function queuedImages(item: QueuedItem): readonly ImageContent[] {
  const blocks = queuedBlocks(item);
  if (typeof blocks === "string") return [];
  return blocks.filter((block): block is ImageContent => block.type === "image");
}

function queuedOf(item: QueuedItem): QueuedMessage {
  return {
    id: Number(item.id),
    mode: item.mode,
    entryKind: item.entry?.kind ?? "pi.user",
    text: queuedText(item),
    images: queuedImages(item),
  };
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
    compacting: ((live as { compactions?: unknown[] }).compactions?.length ?? 0) > 0,
    queued: (inbox?.items ?? []).filter(isQueuedMessage).map(queuedOf),
  };
}
