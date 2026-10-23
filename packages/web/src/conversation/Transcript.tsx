import type {
  AssistantMessage as AssistantMessageData,
  ConversationView,
  ExecutorKind,
  ToolCall,
  ToolSlot,
} from "@tau/protocol";
import { isRetryable, type LiveInfo, readRuntimeLive, todosProjectionOf } from "@tau/protocol";
import { Loader2 } from "lucide-react";
import { Fragment, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/error-message";
import { markLiveReflect } from "@/lib/timings";
import { useApi } from "@/nodes/node-context";
import { TurnChanges } from "./checkpoints/TurnChanges";
import { AssistantMessage, markdownOf } from "./messages/AssistantMessage";
import { NativeNotice } from "./messages/NativeNotice";
import { CompactedDivider, CompactingNotice, RetriedDivider, RetryNotice } from "./messages/notices";
import { QueuedMessages } from "./messages/QueuedMessages";
import { UserMessage } from "./messages/UserMessage";
import { isNativeExecutor } from "./model/executor";
import { nativeNoticeOf, nativeRequestIdsOf, queuedNativeUserKeysOf } from "./model/native-thread";
import { isActive, resolveToolCall } from "./model/tool-state";
import { buildTranscript } from "./model/transcript";
import { isMvpNotificationItem, MvpNotificationRow } from "./notifications/MvpNotificationRow";
import { SubagentNotificationRow } from "./notifications/SubagentNotificationRow";
import { resolvePending, usePendingSends } from "./queue/pending-sends";
import { RetryButton } from "./RetryButton";
import { ToolApproval } from "./ToolApproval";
import { LatestTodoCallProvider } from "./todos/latest-todo-call";
import { ToolCall as ToolCallView } from "./tools/ToolCall";
import { ToolConversationProvider } from "./tools/tool-conversation";
import { newRequestId, sendOptimistically } from "./use-conversation-actions";
import { useProgressiveCount } from "./use-progressive-count";

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

/**
 * Tool calls the run has started but whose assistant entry hasn't committed
 * yet (or whose entry ops were missed): without these the transcript can go
 * blank mid-run — the streaming message hides tool calls, the committed
 * entries aren't there yet, and the active slots suppress `Working…`.
 *
 * Any slot (active *or* done) with no committed entry renders from slot
 * status/output (R3.1: finished calls no longer blink out mid-turn, F5);
 * consumed streaming blocks never linger. This is a visibility fallback, not
 * ordering: without the entry we don't know the call's position, so these
 * render after the committed items. Once the entry arrives (e.g. via a
 * resync base) the committed row takes over. Position caveat stays: slots
 * carry no insertion index.
 */
function callsWithoutEntry(live: LiveInfo, committedIds: ReadonlySet<string>): ToolCall[] {
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
    // Consume the streaming block for any tracked slot — including done ones —
    // so a finished call can't linger as a phantom pending row while its
    // streaming block remains.
    const streamed = streamingById.get(slot.callId);
    streamingById.delete(slot.callId);
    push(streamed ?? synthesizeCall(slot));
  }
  // A streaming tool call before its slot exists (sequential round): show it
  // as pending rather than nothing until the slot/entry commits.
  for (const call of streamingById.values()) push(call);
  return calls;
}

function isIdleWhileBusy(live: LiveInfo): boolean {
  return (
    live.busy &&
    !hasVisibleContent(live.streaming) &&
    !live.retry &&
    !live.slots.some((s) => isActive(s.status))
  );
}

function synthesizeCall(slot: ToolSlot): ToolCall {
  return { id: slot.callId, name: slot.name, arguments: {} } as ToolCall;
}

export function Transcript({
  view,
  onRetry,
  conversationId,
  executor,
}: {
  view: ConversationView;
  onRetry?: (requestId: string) => Promise<unknown>;
  conversationId?: string;
  /** Names a native thread: its busy/queue state and notices come from native entries, and Pi-only rows stay off. */
  executor?: ExecutorKind;
}) {
  const native = isNativeExecutor(executor);
  const transcript = buildTranscript(view);
  const queuedKeys = native ? queuedNativeUserKeysOf(view) : undefined;
  const items = queuedKeys
    ? transcript.items.filter((item) => item.kind !== "user" || !queuedKeys.has(item.entryId))
    : transcript.items;
  const { results } = transcript;
  const notice = native ? nativeNoticeOf(view) : undefined;
  const nativeRequestIds = native ? nativeRequestIdsOf(view) : undefined;
  const firstEntryId = firstMessageEntryId(items);
  const entryOf = (entryId: string, role: "user" | "assistant", text: string) =>
    conversationId && !native
      ? { conversationId, entryId, role, text, startsConversation: entryId === firstEntryId }
      : undefined;
  const live = readRuntimeLive(view, executor);
  const api = useApi();
  const pendings = usePendingSends(conversationId);
  const firstDrawn = items.length - useProgressiveCount(items.length);
  const resolveTool = (call: ToolCall) =>
    resolveToolCall(call, { results, slots: live.slots, busy: live.busy });
  const committedIds = new Set<string>();
  const entryIds = new Set<string>();
  for (const item of items) {
    if (item.kind !== "assistant") continue;
    entryIds.add(item.entryId);
    for (const block of item.message.content) {
      if (block.type === "toolCall") committedIds.add(block.id);
    }
  }
  for (const item of items) {
    if (item.kind === "user") entryIds.add(item.entryId);
  }
  const queuedIds = new Set(live.queued.map((item) => item.id));
  // Reconcile pending sends against live state on exact ids only — never
  // text or entry-count. A sending bubble whose submission landed in the
  // queue morphs into that row (the row renders it); a placed entryId drops
  // the bubble; a native send drops it once the native user event echoes its
  // requestId. Never mutate cached live data: only drop our own rows.
  const isReflected = (pending: (typeof pendings)[number]) =>
    (pending.submissionId !== undefined && !native && queuedIds.has(pending.submissionId)) ||
    (pending.entryId !== undefined && !native && entryIds.has(String(pending.entryId))) ||
    (pending.requestId !== undefined && nativeRequestIds?.has(pending.requestId) === true);
  useEffect(() => {
    if (conversationId === undefined) return;
    for (const pending of pendings) {
      if (pending.status !== "sending" || !isReflected(pending)) continue;
      markLiveReflect("send", pending);
      resolvePending(conversationId, pending.key);
    }
  });
  const visiblePendings = pendings.filter((pending) => pending.status === "failed" || !isReflected(pending));
  const retryPending = (key: string) => async () => {
    if (conversationId === undefined) return;
    const pending = pendings.find((item) => item.key === key);
    if (!pending) return;
    const requestId = newRequestId();
    const { text, images, files, whenBusy } = pending;
    // The failed bubble becomes a sending one at the tap; a failure turns it back.
    resolvePending(conversationId, key);
    try {
      await sendOptimistically(
        conversationId,
        requestId,
        { text, images: [...images], files: [...files], ...(whenBusy && { whenBusy }) },
        api.conversations.send(conversationId, {
          text,
          ...(images.length > 0 && { images: [...images] }),
          ...(files.length > 0 && { files: [...files] }),
          ...(whenBusy && { whenBusy }),
          requestId,
        }),
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const dismissPending = (key: string) => () => {
    if (conversationId !== undefined) resolvePending(conversationId, key);
  };
  const unplacedCalls = callsWithoutEntry(live, committedIds);
  if (
    items.length === 0 &&
    !live.busy &&
    !live.compacting &&
    live.queued.length === 0 &&
    visiblePendings.length === 0 &&
    unplacedCalls.length === 0 &&
    !notice
  )
    return <EmptyTranscript />;
  return (
    <ToolConversationProvider value={conversationId}>
      <LatestTodoCallProvider value={todosProjectionOf(view).source}>
        <div className="space-y-5">
          {items.map((item, index) => {
            if (index < firstDrawn) return null;
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
                {conversationId && turnEntryId && !native ? (
                  <TurnChanges conversationId={conversationId} entryId={turnEntryId} />
                ) : null}
              </Fragment>
            );
          })}
          {hasVisibleContent(live.streaming) ? (
            <AssistantMessage message={live.streaming} resolveTool={resolveTool} streaming />
          ) : null}
          {unplacedCalls.map((call) => (
            <div key={`running-${call.id}`} className="space-y-2">
              <ToolCallView state={resolveTool(call)} />
            </div>
          ))}
          {visiblePendings.map((pending) => (
            <div key={pending.key} className="space-y-1">
              <UserMessage
                text={pending.text}
                images={pending.images.map((image) => ({ type: "image" as const, ...image }))}
                pending
              />
              <div className="flex items-center justify-end gap-2">
                {pending.status === "sending" ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    Sending…
                  </p>
                ) : (
                  <>
                    <p role="alert" className="text-xs text-destructive">
                      {pending.error ?? "Send failed"}
                    </p>
                    <Button type="button" variant="ghost" size="sm" onClick={retryPending(pending.key)}>
                      Retry
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={dismissPending(pending.key)}>
                      Dismiss
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
          {live.compacting ? <CompactingNotice /> : null}
          {live.retry ? <RetryNotice retry={live.retry} /> : null}
          {isIdleWhileBusy(live) ? <WorkingIndicator /> : null}
          {notice ? <NativeNotice notice={notice} /> : null}
          {onRetry && !native && isRetryable(view) ? <RetryButton onRetry={onRetry} /> : null}
          {conversationId && !native ? <ToolApproval conversationId={conversationId} /> : null}
          <QueuedMessages items={live.queued} conversationId={native ? undefined : conversationId} />
        </div>
      </LatestTodoCallProvider>
    </ToolConversationProvider>
  );
}
