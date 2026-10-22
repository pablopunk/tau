import type {
  AssistantMessage as AssistantMessageData,
  ConversationView,
  ToolCall,
  ToolSlot,
} from "@tau/protocol";
import { isRetryable, type LiveInfo, readLive } from "@tau/protocol";
import { Loader2 } from "lucide-react";
import { Fragment } from "react";
import { TurnChanges } from "./checkpoints/TurnChanges";
import { AssistantMessage, markdownOf } from "./messages/AssistantMessage";
import { CompactedDivider, CompactingNotice, RetriedDivider, RetryNotice } from "./messages/notices";
import { QueuedMessages } from "./messages/QueuedMessages";
import { UserMessage } from "./messages/UserMessage";
import { isActive, resolveToolCall } from "./model/tool-state";
import { buildTranscript } from "./model/transcript";
import { isMvpNotificationItem, MvpNotificationRow } from "./notifications/MvpNotificationRow";
import { SubagentNotificationRow } from "./notifications/SubagentNotificationRow";
import { RetryButton } from "./RetryButton";
import { ToolApproval } from "./ToolApproval";
import { LatestTodoCallProvider } from "./todos/latest-todo-call";
import { latestTodoSource } from "./todos/todo-items";
import { ToolCall as ToolCallView } from "./tools/ToolCall";
import { ToolConversationProvider } from "./tools/tool-conversation";

function hasVisibleContent(message: AssistantMessageData | undefined): message is AssistantMessageData {
  return (
    message?.content.some((block) => (block.type === "text" ? block.text : block.type === "thinking")) ??
    false
  );
}

type Item = ReturnType<typeof buildTranscript>["items"][number];

function firstMessageEntryId(items: readonly Item[]): string | undefined {
  const first = items[0];
  return first?.kind === "user" ? first.entryId : undefined;
}

function endsTurn(items: readonly Item[], index: number): string | undefined {
  if (items[index + 1]?.kind === "assistant") return undefined;
  for (let i = index; i >= 0; i--) {
    const item = items[i];
    if (item?.kind === "user") return item.entryId;
  }
  return undefined;
}

function EmptyTranscript() {
  return <p className="py-16 text-center text-sm text-muted-foreground">Send a message to start.</p>;
}

function WorkingIndicator() {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 aria-hidden className="size-3.5 animate-spin" />
      Working…
    </p>
  );
}

function isIdleWhileBusy(live: LiveInfo): boolean {
  return (
    live.busy &&
    !hasVisibleContent(live.streaming) &&
    !live.retry &&
    !live.slots.some((s) => isActive(s.status))
  );
}

/**
 * Tool calls the run has started but whose assistant entry hasn't committed
 * yet (or whose entry ops were missed): without these the transcript can go
 * blank mid-run — the streaming message hides tool calls, the committed
 * entries aren't there yet, and the active slots suppress `Working…`.
 *
 * This is a visibility fallback, not ordering: without the entry we don't know
 * the call's position, so these render after the committed items. Once the
 * entry arrives (e.g. via a resync base) the committed row takes over.
 */
function runningCallsWithoutEntry(live: LiveInfo, committedIds: ReadonlySet<string>): ToolCall[] {
  const streamingById = new Map<string, ToolCall>();
  for (const block of live.streaming?.content ?? []) {
    if (block.type === "toolCall" && !committedIds.has(block.id)) streamingById.set(block.id, block);
  }
  const calls: ToolCall[] = [];
  const seen = new Set<string>();
  const push = (call: ToolCall) => {
    if (seen.has(call.id)) return;
    seen.add(call.id);
    calls.push(call);
  };
  for (const slot of live.slots) {
    if (committedIds.has(slot.callId)) {
      streamingById.delete(slot.callId);
      continue;
    }
    // Consume the streaming block for any tracked slot — including done ones
    // — so a finished call can't linger as a phantom pending row while its
    // streaming block remains.
    const streamed = streamingById.get(slot.callId);
    streamingById.delete(slot.callId);
    if (!isActive(slot.status)) continue;
    push(streamed ?? synthesizeCall(slot));
  }
  // A streaming tool call before its slot exists (sequential round): show it
  // as pending rather than nothing until the slot/entry commits.
  for (const call of streamingById.values()) push(call);
  return calls;
}

function synthesizeCall(slot: ToolSlot): ToolCall {
  return { id: slot.callId, name: slot.name, arguments: {} } as ToolCall;
}

export function Transcript({
  view,
  onRetry,
  conversationId,
}: {
  view: ConversationView;
  onRetry?: (requestId: string) => Promise<unknown>;
  conversationId?: string;
}) {
  const { items, results } = buildTranscript(view);
  const firstEntryId = firstMessageEntryId(items);
  const entryOf = (entryId: string, role: "user" | "assistant", text: string) =>
    conversationId
      ? { conversationId, entryId, role, text, startsConversation: entryId === firstEntryId }
      : undefined;
  const live = readLive(view);
  const resolveTool = (call: ToolCall) =>
    resolveToolCall(call, { results, slots: live.slots, busy: live.busy });
  const committedIds = new Set<string>();
  for (const item of items) {
    if (item.kind !== "assistant") continue;
    for (const block of item.message.content) {
      if (block.type === "toolCall") committedIds.add(block.id);
    }
  }
  const runningCalls = runningCallsWithoutEntry(live, committedIds);
  if (items.length === 0 && !live.busy && !live.compacting && live.queued.length === 0)
    return <EmptyTranscript />;
  return (
    <ToolConversationProvider value={conversationId}>
      <LatestTodoCallProvider value={latestTodoSource(view)}>
        <div className="space-y-5">
          {items.map((item, index) => {
            if (item.kind === "compaction") return <CompactedDivider key={item.key} />;
            if (item.kind === "subagent-notification")
              return <SubagentNotificationRow key={item.key} data={item.data} />;
            if (isMvpNotificationItem(item)) return <MvpNotificationRow key={item.key} item={item} />;
            if (item.kind === "retry") return <RetriedDivider key={item.key} />;
            if (item.kind === "user")
              return (
                <UserMessage
                  key={item.key}
                  text={item.text}
                  images={item.images}
                  entry={entryOf(item.entryId, "user", item.text)}
                />
              );
            const turnEntryId = endsTurn(items, index);
            return (
              <Fragment key={item.key}>
                <AssistantMessage
                  message={item.message}
                  resolveTool={resolveTool}
                  entry={entryOf(item.entryId, "assistant", markdownOf(item.message))}
                />
                {conversationId && turnEntryId ? (
                  <TurnChanges conversationId={conversationId} entryId={turnEntryId} />
                ) : null}
              </Fragment>
            );
          })}
          {hasVisibleContent(live.streaming) ? (
            <AssistantMessage message={live.streaming} resolveTool={resolveTool} streaming />
          ) : null}
          {runningCalls.map((call) => (
            <div key={`running-${call.id}`} className="space-y-2">
              <ToolCallView state={resolveTool(call)} />
            </div>
          ))}
          {live.compacting ? <CompactingNotice /> : null}
          {live.retry ? <RetryNotice retry={live.retry} /> : null}
          {isIdleWhileBusy(live) ? <WorkingIndicator /> : null}
          {onRetry && isRetryable(view) ? <RetryButton onRetry={onRetry} /> : null}
          {conversationId ? <ToolApproval conversationId={conversationId} /> : null}
          <QueuedMessages items={live.queued} conversationId={conversationId} />
        </div>
      </LatestTodoCallProvider>
    </ToolConversationProvider>
  );
}
