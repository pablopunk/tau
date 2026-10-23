import { type ExecutorKind, readRuntimeLive } from "@tau/protocol";
import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useMatch } from "react-router";
import type { PickersHandle } from "@/components/ModelThinkingPickers";
import { Button } from "@/components/ui/button";
import { AnimatePresence, gentle, motion } from "@/components/ui/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { PendingFirstMessage } from "@/conversation/PendingFirstMessage";
import { GoalChip } from "@/goal/GoalChip";
import { useAllConversations, useModels, useRuntimes, useSettings } from "@/lib/queries";
import { claudeCodeDisabledReason } from "@/lib/runtimes";
import { useApi, useNodeId } from "@/nodes/node-context";
import { ThreadTerminalButton } from "@/panes";
import { firstMessageOf, forgetFirstMessage } from "@/routes/first-message";
import { NameDialog } from "@/sidebar/NameDialog";
import { SubagentBanner } from "@/sidebar/subagents/SubagentBanner";
import { WorkspaceChip } from "@/workspaces/WorkspaceChip";
import { Composer } from "./Composer";
import { nativeCommandsOf } from "./composer/slash-commands";
import { useThreadCommands } from "./composer/use-thread-commands";
import { imagesAllowedFor } from "./model/agent";
import { isNativeExecutor, NATIVE_ATTACHMENTS_REASON, threadExecutorOf } from "./model/executor";
import { BusyModeHint } from "./queue/BusyModeHint";
import { whenBusyOf } from "./queue/queued-mode";
import { stopAndRestore } from "./queue/stop-restore";
import { ConversationSidebar } from "./sidebar/ConversationSidebar";
import { SidebarToggleButton } from "./sidebar/SidebarToggleButton";
import type { SidebarSectionId } from "./sidebar/sections";
import { useConversationSidebarOpen } from "./sidebar/use-sidebar-open";
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
  executor,
}: {
  id: string;
  state: ConversationViewState;
  onRetry?: (requestId: string) => Promise<unknown>;
  executor?: ExecutorKind;
}) {
  const location = useLocation();
  if (state.status === "loading") {
    const firstMessage = firstMessageOf(location.state);
    return firstMessage ? <PendingFirstMessage message={firstMessage} /> : <LoadingTranscript />;
  }
  if (state.status === "gone") return <DeletedThread />;
  return <Transcript view={state.view} onRetry={onRetry} conversationId={id} executor={executor} />;
}

function ConversationPanel({ id }: ConversationProps) {
  const state = useConversationView(id);
  const location = useLocation();
  const actions = useConversationActions(id);
  const api = useApi();
  const nodeId = useNodeId();
  const { scrollRef, contentRef, atBottom, onScroll, scrollToBottom } = useStickToBottom();
  const models = useModels().data;
  const summary = useAllConversations().data?.find((item) => item.id === id);
  const pickers = useRef<PickersHandle>(null);
  const thread = useThreadCommands({ conversationId: id, projectId: summary?.projectId, pickers });
  const view = state.status === "ready" ? state.view : undefined;
  const executor = threadExecutorOf(summary, view);
  const native = isNativeExecutor(executor);
  const runtimes = useRuntimes({ enabled: native });
  const nativeDisabledReason = native ? claudeCodeDisabledReason(runtimes.data) : undefined;
  const busy = state.status === "ready" && readRuntimeLive(state.view, executor).busy;
  const queued = view ? readRuntimeLive(view, executor).queued : [];
  const handleStop = useCallback(() => stopAndRestore(api, id, nodeId, queued), [api, id, nodeId, queued]);
  const messageMode = useSettings().data?.messageMode;
  const whenBusy = messageMode ? whenBusyOf(messageMode) : undefined;
  useEffect(() => {
    if (state.status !== "loading") forgetFirstMessage(location.state);
  }, [location.state, state.status]);
  const parentId = summary?.parentId ?? null;
  const { open: sidebarPref, setOpen: setSidebarOpen, toggle: toggleSidebar } = useConversationSidebarOpen();
  // Terminal masks the sidebar without touching the stored preference.
  const [terminalMask, setTerminalMask] = useState(false);
  const localTerminal = useMatch("/p/:projectId/c/:conversationId/terminal/:terminalId");
  const remoteTerminal = useMatch("/n/:nodeId/p/:projectId/c/:conversationId/terminal/:terminalId");
  const terminalOpen = localTerminal !== null || remoteTerminal !== null;
  useEffect(() => {
    setTerminalMask(terminalOpen);
  }, [terminalOpen]);
  const sidebarOpen = sidebarPref && !terminalMask;
  const [reveal, setReveal] = useState<SidebarSectionId | null>(null);
  const revealSection = useCallback(
    (section: SidebarSectionId) => {
      setSidebarOpen(true);
      setReveal(section);
    },
    [setSidebarOpen],
  );
  const handleRevealed = useCallback(() => setReveal(null), []);
  return (
    <div data-testid="conversation" className="relative flex h-full min-h-0 flex-col bg-background">
      {/* Always mounted: on mobile it carries the sidebar toggle, even while the view loads. */}
      <ThreadHeader
        id={id}
        hideMachine={sidebarOpen}
        extras={
          sidebarOpen ? null : (
            <>
              {native ? null : <GoalChip conversationId={id} onReveal={() => revealSection("goal")} />}
              <WorkspaceChip conversationId={id} />
            </>
          )
        }
        actions={
          <div className="flex items-center gap-1.5">
            <ThreadTerminalButton />
            <span className="hidden md:inline-flex">
              <SidebarToggleButton open={sidebarOpen} onToggle={toggleSidebar} disabled={terminalOpen} />
            </span>
          </div>
        }
      />
      {parentId ? <SubagentBanner parentId={parentId} childId={id} /> : null}
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
          >
            {/* relative: contains absolute descendants (e.g. sr-only) so they can't inflate the outer scroll container */}
            <div ref={contentRef} className="relative mx-auto w-full min-w-0 max-w-3xl px-4 py-6">
              <section aria-label="Conversation" aria-live="polite" aria-relevant="additions">
                <Body
                  id={id}
                  state={state}
                  onRetry={parentId || native ? undefined : actions.retry}
                  executor={executor}
                />
              </section>
            </div>
          </div>
          <AnimatePresence initial={false}>
            {atBottom ? null : (
              <motion.div
                key="jump-latest"
                initial={{ opacity: 0, y: 8, x: "-50%" }}
                animate={{ opacity: 1, y: 0, x: "-50%" }}
                exit={{ opacity: 0, y: 8, x: "-50%" }}
                transition={gentle}
                className="absolute bottom-24 left-1/2"
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full bg-background shadow-md"
                  onClick={scrollToBottom}
                >
                  <ArrowDown /> Jump to latest
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
          {state.status === "gone" || parentId ? null : (
            <div className="mx-auto w-full max-w-3xl px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Composer
                target={id}
                imagesAllowed={!native && imagesAllowedFor(view, models)}
                busy={busy}
                disabled={nativeDisabledReason !== undefined}
                disabledReason={nativeDisabledReason}
                whenBusy={native ? "followUp" : whenBusy}
                followUpOnly={native}
                attachmentsBlockedReason={native ? NATIVE_ATTACHMENTS_REASON : undefined}
                hint={native ? undefined : <BusyModeHint busy={busy} />}
                abovePanel={
                  view && !sidebarOpen && !native ? <TodoPanel conversationId={id} view={view} /> : undefined
                }
                toolbar={
                  view ? (
                    <ThreadToolbar
                      id={id}
                      view={view}
                      pickers={pickers}
                      sidebarOpen={sidebarOpen}
                      onRevealSection={revealSection}
                      executor={executor}
                    />
                  ) : undefined
                }
                commands={native ? nativeCommandsOf(thread.commands) : thread.commands}
                projectId={summary?.projectId}
                onSend={actions.send}
                onStop={handleStop}
                onSent={scrollToBottom}
              />
            </div>
          )}
        </div>
        {sidebarOpen && view ? (
          <ConversationSidebar
            conversationId={id}
            view={view}
            reveal={reveal}
            onRevealed={handleRevealed}
            native={native}
          />
        ) : null}
      </div>
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
