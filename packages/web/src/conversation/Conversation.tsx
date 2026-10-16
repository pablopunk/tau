import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Composer } from "./Composer";
import { readLive } from "./model/live";
import { Transcript } from "./Transcript";
import { useConversationActions } from "./use-conversation-actions";
import { type ConversationViewState, useConversationView } from "./use-conversation-view";
import { useStickToBottom } from "./use-stick-to-bottom";

export interface ConversationProps {
  /** The conversation to show, as in `/p/:projectId/c/:conversationId`. */
  readonly id: string;
}

function Placeholder({ children }: { children: string }) {
  return <p className="py-16 text-center text-sm text-muted-foreground">{children}</p>;
}

function LoadingTranscript() {
  return (
    <div aria-busy className="space-y-4" role="status">
      <span className="sr-only">Loading conversation</span>
      <Skeleton className="ml-auto h-9 w-1/2" />
      <Skeleton className="h-16 w-3/4" />
    </div>
  );
}

function Body({ state }: { state: ConversationViewState }) {
  if (state.status === "loading") return <LoadingTranscript />;
  if (state.status === "gone") return <Placeholder>This conversation is no longer available.</Placeholder>;
  return <Transcript view={state.view} />;
}

function ConversationPanel({ id }: ConversationProps) {
  const state = useConversationView(id);
  const actions = useConversationActions(id);
  const { scrollRef, contentRef, atBottom, onScroll, scrollToBottom } = useStickToBottom();
  const busy = state.status === "ready" && readLive(state.view).busy;
  return (
    <div data-testid="conversation" className="relative flex h-full min-h-0 flex-col bg-background">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div ref={contentRef} className="mx-auto w-full max-w-3xl px-4 py-6">
          <section aria-label="Conversation" aria-live="polite" aria-relevant="additions">
            <Body state={state} />
          </section>
        </div>
      </div>
      {atBottom ? null : (
        <Button
          variant="outline"
          size="sm"
          className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-background shadow-md"
          onClick={scrollToBottom}
        >
          <ArrowDown /> Jump to latest
        </Button>
      )}
      {state.status === "gone" ? null : (
        <div className="mx-auto w-full max-w-3xl px-3 pt-1 pb-3 sm:px-4 sm:pb-4">
          <Composer busy={busy} onSend={actions.send} onStop={actions.stop} onSent={scrollToBottom} />
        </div>
      )}
    </div>
  );
}

export function Conversation({ id }: ConversationProps) {
  return <ConversationPanel key={id} id={id} />;
}
