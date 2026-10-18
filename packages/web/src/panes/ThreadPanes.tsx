import type { ReactNode } from "react";

export interface ThreadPanesProps {
  readonly projectId: string;
  readonly conversationId: string;
  readonly terminalId: string | undefined;
  /** The existing conversation column; it must keep its scroll, auto-follow and pinned composer. */
  readonly children: ReactNode;
}

/** Placeholder (owner C): the transcript next to the pane strip. Until then it renders only the conversation. */
export function ThreadPanes({ children }: ThreadPanesProps) {
  return <>{children}</>;
}
