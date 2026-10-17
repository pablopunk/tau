import type {
  AssistantMessage as AssistantMessageData,
  ConversationView,
  ToolCall,
} from "@pi-everywhere/protocol";
import { isRetryable } from "@pi-everywhere/protocol";
import { Loader2 } from "lucide-react";
import { AssistantMessage, markdownOf } from "./messages/AssistantMessage";
import { CompactedDivider, CompactingNotice, RetriedDivider, RetryNotice } from "./messages/notices";
import { QueuedMessages } from "./messages/QueuedMessages";
import { UserMessage } from "./messages/UserMessage";
import { type LiveInfo, readLive } from "./model/live";
import { isActive, resolveToolCall } from "./model/tool-state";
import { buildTranscript } from "./model/transcript";
import { RetryButton } from "./RetryButton";

function hasVisibleContent(message: AssistantMessageData | undefined): message is AssistantMessageData {
  return (
    message?.content.some((block) => (block.type === "text" ? block.text : block.type === "thinking")) ??
    false
  );
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

export function Transcript({
  view,
  onRetry,
  conversationId,
}: {
  view: ConversationView;
  onRetry(requestId: string): Promise<void>;
  conversationId?: string;
}) {
  const entryOf = (entryId: string, role: "user" | "assistant", text: string) =>
    conversationId ? { conversationId, entryId, role, text } : undefined;
  const { items, results } = buildTranscript(view);
  const live = readLive(view);
  const resolveTool = (call: ToolCall) =>
    resolveToolCall(call, { results, slots: live.slots, busy: live.busy });
  if (items.length === 0 && !live.busy && !live.compacting && live.queued.length === 0)
    return <EmptyTranscript />;
  return (
    <div className="space-y-5">
      {items.map((item) => {
        if (item.kind === "compaction") return <CompactedDivider key={item.key} />;
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
        return (
          <AssistantMessage
            key={item.key}
            message={item.message}
            resolveTool={resolveTool}
            entry={entryOf(item.entryId, "assistant", markdownOf(item.message))}
          />
        );
      })}
      {hasVisibleContent(live.streaming) ? (
        <AssistantMessage message={live.streaming} resolveTool={resolveTool} streaming />
      ) : null}
      {live.compacting ? <CompactingNotice /> : null}
      {live.retry ? <RetryNotice retry={live.retry} /> : null}
      {isIdleWhileBusy(live) ? <WorkingIndicator /> : null}
      {isRetryable(view) ? <RetryButton onRetry={onRetry} /> : null}
      <QueuedMessages items={live.queued} conversationId={conversationId} />
    </div>
  );
}
