import { ArrowDown } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useModels } from "@/lib/queries";
import { Composer } from "./Composer";
import { imagesAllowedFor } from "./model/agent";
import { readLive } from "./model/live";
import { ThreadHeader } from "./ThreadHeader";
import { Transcript } from "./Transcript";
import { useConversationActions } from "./use-conversation-actions";
import { type ConversationViewState, useConversationView } from "./use-conversation-view";
import { useStickToBottom } from "./use-stick-to-bottom";

export interface ConversationProps {
  /** The conversation to show, as in `/p/:projectId/c/:conversationId`. */
  readonly id: string;
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

function DeletedThread() {
  return (
    <div className="space-y-3 py-16 text-center">
      <p className="text-sm text-muted-foreground">This thread was deleted</p>
      <Button asChild variant="outline" size="sm">
        <Link to="/">Back to new thread</Link>
      </Button>
    </div>
  );
}

function Body({
  state,
  onRetry,
}: {
  state: ConversationViewState;
  onRetry(requestId: string): Promise<void>;
}) {
  if (state.status === "loading") return <LoadingTranscript />;
  if (state.status === "gone") return <DeletedThread />;
  return <Transcript view={state.view} onRetry={onRetry} />;
}

function ConversationPanel({ id }: ConversationProps) {
  const state = useConversationView(id);
  const actions = useConversationActions(id);
  const { scrollRef, contentRef, atBottom, onScroll, scrollToBottom } = useStickToBottom();
  const models = useModels().data;
  const view = state.status === "ready" ? state.view : undefined;
  const busy = state.status === "ready" && readLive(state.view).busy;
  return (
    <div data-testid="conversation" className="relative flex h-full min-h-0 flex-col bg-background">
      {view ? <ThreadHeader id={id} view={view} /> : null}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div ref={contentRef} className="mx-auto w-full max-w-3xl px-4 py-6">
          <section aria-label="Conversation" aria-live="polite" aria-relevant="additions">
            <Body state={state} onRetry={actions.retry} />
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
          <Composer
            target={id}
            imagesAllowed={imagesAllowedFor(view, models)}
            busy={busy}
            onSend={actions.send}
            onStop={actions.stop}
            onSent={scrollToBottom}
          />
        </div>
      )}
    </div>
  );
}

export function Conversation({ id }: ConversationProps) {
  return <ConversationPanel key={id} id={id} />;
}
