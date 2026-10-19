import type { TerminalInfo } from "@tau/protocol";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { PaneSplitter } from "@/components/ui/pane-splitter";
import { PaneStrip, type PaneTab } from "@/components/ui/pane-strip";
import { conversationPath, terminalPath } from "@/lib/paths";
import { useNodeId } from "@/nodes/node-context";
import { readSplit, SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN, writeSplit } from "./split-width";
import { TerminalPane } from "./terminal/TerminalPane";
import { useNarrow } from "./use-narrow";
import { useTerminalChanges } from "./use-terminal-changes";
import {
  useCloseTerminal,
  useOpenAndFocusTerminal,
  useTerminals,
  useTerminalsAvailable,
} from "./use-terminals";

export interface ThreadPanesProps {
  readonly projectId: string;
  readonly conversationId: string;
  readonly terminalId: string | undefined;
  /** The existing conversation column; it must keep its scroll, auto-follow and pinned composer. */
  readonly children: ReactNode;
}

const CHAT_TAB: PaneTab = { kind: "chat", id: "chat", title: "Chat", closable: false };

function tabsOf(terminals: readonly TerminalInfo[], narrow: boolean): PaneTab[] {
  const list = terminals.map((terminal, index) => ({
    kind: "terminal",
    id: terminal.id,
    title: narrow ? `Terminal ${index + 1}` : terminal.title,
    ended: terminal.status === "exited",
  }));
  return narrow ? [CHAT_TAB, ...list] : list;
}

function focusComposer(root: HTMLElement | null) {
  root?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus();
}

/** The transcript next to the pane strip (side by side, or tabs below 760 px). The transcript is always the first, keyed child, so it never remounts. */
export function ThreadPanes({ projectId, conversationId, terminalId, children }: ThreadPanesProps) {
  const nodeId = useNodeId();
  useTerminalChanges();
  const navigate = useNavigate();
  const narrow = useNarrow();
  const root = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(readSplit);
  const available = useTerminalsAvailable().data === true;
  const terminals = useTerminals(conversationId, available);
  const close = useCloseTerminal(conversationId);
  const open = useOpenAndFocusTerminal(projectId, conversationId);
  const list = terminals.data ?? [];
  const showStrip = available && (list.length > 0 || terminalId !== undefined);
  const focusedTerminal = terminalId ?? (narrow ? undefined : list[0]?.id);
  const focusedId = narrow && focusedTerminal === undefined ? CHAT_TAB.id : focusedTerminal;

  const changeSplit = useCallback((percent: number) => {
    setSplit(percent);
    writeSplit(percent);
  }, []);
  const resetSplit = useCallback(() => changeSplit(SPLIT_DEFAULT), [changeSplit]);
  const focus = (tab: PaneTab) =>
    navigate(
      tab.kind === "chat"
        ? conversationPath(projectId, conversationId, nodeId)
        : terminalPath(projectId, conversationId, tab.id, nodeId),
    );
  const closeTab = (tab: PaneTab) => {
    close.mutate(tab.id);
    if (tab.id !== focusedTerminal) return;
    const next = list.find((terminal) => terminal.id !== tab.id);
    navigate(
      next
        ? terminalPath(projectId, conversationId, next.id, nodeId)
        : conversationPath(projectId, conversationId, nodeId),
    );
  };

  const gone =
    terminalId !== undefined && terminals.isSuccess && !list.some((terminal) => terminal.id === terminalId);
  const nextId = list[0]?.id;
  useEffect(() => {
    if (!gone) return;
    navigate(
      nextId
        ? terminalPath(projectId, conversationId, nextId, nodeId)
        : conversationPath(projectId, conversationId, nodeId),
      { replace: true },
    );
  }, [gone, nextId, navigate, projectId, conversationId, nodeId]);

  const body =
    focusedTerminal && !gone ? (
      <TerminalPane
        key={focusedTerminal}
        terminalId={focusedTerminal}
        onLeave={() => focusComposer(root.current)}
      />
    ) : null;
  const showChat = !(narrow && showStrip && focusedId !== CHAT_TAB.id);
  const strip = showStrip ? (
    <PaneStrip
      key="strip"
      tabs={tabsOf(list, narrow)}
      focusedId={focusedId}
      onFocus={focus}
      onClose={closeTab}
      onAdd={open.run}
      addLabel="New terminal"
      className={narrow ? undefined : "h-full"}
      style={narrow ? undefined : { width: `${100 - split}%` }}
    >
      {narrow ? undefined : body}
    </PaneStrip>
  ) : null;

  return (
    <div
      ref={root}
      data-slot="thread-panes"
      className={
        narrow
          ? "relative flex h-full min-h-0 min-w-0 flex-col"
          : "relative flex h-full min-h-0 min-w-0 flex-row"
      }
    >
      {narrow ? strip : null}
      <div
        key="chat"
        hidden={!showChat}
        className="h-full min-h-0 min-w-0 flex-1"
        style={narrow || !showStrip ? undefined : { flex: `0 0 ${split}%` }}
      >
        {children}
      </div>
      {showStrip && !narrow ? (
        <PaneSplitter
          key="split"
          value={split}
          min={SPLIT_MIN}
          max={SPLIT_MAX}
          containerRef={root}
          onChange={changeSplit}
          onReset={resetSplit}
        />
      ) : null}
      {narrow ? (
        showChat ? null : (
          <div key="body" className="min-h-0 flex-1">
            {body}
          </div>
        )
      ) : (
        strip
      )}
    </div>
  );
}
