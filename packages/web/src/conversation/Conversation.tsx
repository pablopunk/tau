import { ArrowDown } from "lucide-react";
import { useRef } from "react";
import { Link } from "react-router";
import type { PickersHandle } from "@/components/ModelThinkingPickers";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAllConversations, useModels, useSettings } from "@/lib/queries";
import { NameDialog } from "@/sidebar/NameDialog";
import { SubagentBanner } from "@/sidebar/subagents/SubagentBanner";
import { WorkspaceChip } from "@/workspaces/WorkspaceChip";
import { Composer } from "./Composer";
import { useThreadCommands } from "./composer/use-thread-commands";
import { imagesAllowedFor } from "./model/agent";
import { readLive } from "./model/live";
import { BusyModeHint } from "./queue/BusyModeHint";
import { whenBusyOf } from "./queue/queued-mode";
import { ThreadHeader } from "./ThreadHeader";
import { ThreadToolbar } from "./ThreadToolbar";
import { Transcript } from "./Transcript";
import { TodoPanel } from "./todos/TodoPanel";
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
  id,
  state,
  onRetry,
}: {
  id: string;
  state: ConversationViewState;
  onRetry(requestId: string): Promise<void>;
}) {
  if (state.status === "loading") return <LoadingTranscript />;
  if (state.status === "gone") return <DeletedThread />;
  return <Transcript view={state.view} onRetry={onRetry} conversationId={id} />;
}

function ConversationPanel({ id }: ConversationProps) {
  const state = useConversationView(id);
  const actions = useConversationActions(id);
  const { scrollRef, contentRef, atBottom, onScroll, scrollToBottom } = useStickToBottom();
  const models = useModels().data;
  const summary = useAllConversations().data?.find((item) => item.id === id);
  const pickers = useRef<PickersHandle>(null);
  const thread = useThreadCommands({ conversationId: id, projectId: summary?.projectId, pickers });
  const view = state.status === "ready" ? state.view : undefined;
  const busy = state.status === "ready" && readLive(state.view).busy;
  const messageMode = useSettings().data?.messageMode;
  const whenBusy = messageMode ? whenBusyOf(messageMode) : undefined;
  const parentId = summary?.parentId ?? null;
  return (
    <div data-testid="conversation" className="relative flex h-full min-h-0 flex-col bg-background">
      {view ? <ThreadHeader id={id} extras={<WorkspaceChip conversationId={id} />} /> : null}
      {parentId ? <SubagentBanner parentId={parentId} childId={id} /> : null}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div ref={contentRef} className="mx-auto w-full max-w-3xl px-4 py-6">
          <section aria-label="Conversation" aria-live="polite" aria-relevant="additions">
            <Body id={id} state={state} onRetry={actions.retry} />
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
      {state.status === "gone" || parentId ? null : (
        <div className="mx-auto w-full max-w-3xl px-3 pt-1 pb-3 sm:px-4 sm:pb-4">
          <Composer
            target={id}
            imagesAllowed={imagesAllowedFor(view, models)}
            busy={busy}
            whenBusy={whenBusy}
            footer={<BusyModeHint busy={busy} />}
            abovePanel={view ? <TodoPanel conversationId={id} view={view} /> : undefined}
            toolbar={view ? <ThreadToolbar id={id} view={view} pickers={pickers} /> : undefined}
            commands={thread.commands}
            projectId={summary?.projectId}
            onSend={actions.send}
            onStop={actions.stop}
            onSent={scrollToBottom}
          />
        </div>
      )}
      {thread.renaming ? (
        <NameDialog
          title="Rename thread"
          label="Thread name"
          initialValue={summary?.title ?? ""}
          onSubmit={thread.rename}
          onClose={thread.closeRename}
        />
      ) : null}
    </div>
  );
}

export function Conversation({ id }: ConversationProps) {
  return <ConversationPanel key={id} id={id} />;
}
