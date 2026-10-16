import type { JsonValue } from "@earendil-works/chord";
import { diffRevisions } from "@earendil-works/chord/delta";
import type { ConversationView, EntryRecord, InboxState, LiveState, Op } from "@pi-everywhere/protocol";

type Docs = Record<string, unknown>;

export function emptyView(
  conversationId: number,
  cwd: string,
  model: { provider: string; modelId: string },
): ConversationView {
  const docs: Docs = {
    "pi.agent": { model, cwd },
    "pi.live": {},
    "pi.inbox": { items: [] },
    "pi.provider": { sessionId: `fake-session-${conversationId}` },
    "pi.usage": { models: {}, tools: {} },
  };
  return { conversation: { id: conversationId }, entries: [], docs } as unknown as ConversationView;
}

export function diffViews(before: ConversationView, after: ConversationView): Op[] {
  return diffRevisions(before as unknown as JsonValue, after as unknown as JsonValue);
}

function maxEntryId(view: ConversationView): number {
  return view.entries.reduce((max, entry) => Math.max(max, Number(entry.id)), 0);
}

function shiftEntry(entry: EntryRecord, offset: number): EntryRecord {
  return { ...entry, id: Number(entry.id) + offset } as unknown as EntryRecord;
}

function shiftLive(live: LiveState | undefined, offset: number): LiveState | undefined {
  if (!live?.tools) return live;
  const tools = live.tools.map((slot) =>
    slot.entry === undefined ? slot : { ...slot, entry: Number(slot.entry) + offset },
  );
  return { ...live, tools } as unknown as LiveState;
}

/** Appends the fixture's entries to the conversation's existing ones, keeping entry ids unique. */
export function rebase(base: ConversationView, fixtureView: ConversationView): ConversationView {
  const offset = maxEntryId(base);
  const live = shiftLive(fixtureView.docs["pi.live"] as LiveState | undefined, offset);
  const docs: Docs = {
    ...base.docs,
    ...fixtureView.docs,
    "pi.agent": base.docs["pi.agent"],
    "pi.provider": base.docs["pi.provider"],
  };
  if (live) docs["pi.live"] = live;
  return {
    conversation: base.conversation,
    entries: [...base.entries, ...fixtureView.entries.map((entry) => shiftEntry(entry, offset))],
    docs,
  } as unknown as ConversationView;
}

export function substituteText(view: ConversationView, from: string, to: string): ConversationView {
  if (from === to) return view;
  const jsonEscaped = (text: string) => JSON.stringify(text).slice(1, -1);
  return JSON.parse(JSON.stringify(view).split(jsonEscaped(from)).join(jsonEscaped(to))) as ConversationView;
}

export function withoutRun(view: ConversationView): ConversationView {
  return {
    ...view,
    docs: { ...view.docs, "pi.live": {}, "pi.inbox": { items: [] } },
  } as unknown as ConversationView;
}

export function withInbox(view: ConversationView, items: InboxState["items"]): ConversationView {
  return { ...view, docs: { ...view.docs, "pi.inbox": { items } } } as unknown as ConversationView;
}

export function inboxOf(view: ConversationView): InboxState["items"] {
  return (view.docs["pi.inbox"] as InboxState | undefined)?.items ?? [];
}

export function isRunning(view: ConversationView): boolean {
  return (view.docs["pi.live"] as LiveState | undefined)?.run !== undefined;
}
