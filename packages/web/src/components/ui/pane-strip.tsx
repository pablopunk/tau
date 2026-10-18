import type { ReactNode } from "react";

export interface PaneTab {
  readonly kind: string;
  readonly id: string;
  readonly title: string;
}

export interface PaneStripProps {
  readonly tabs: readonly PaneTab[];
  readonly focusedId: string | undefined;
  readonly onFocus: (tab: PaneTab) => void;
  readonly onClose: (tab: PaneTab) => void;
  readonly children?: ReactNode;
}

/** Placeholder (owner C): the strip of open panes, tabs below 760 px. */
export function PaneStrip({ children }: PaneStripProps) {
  return <div>{children}</div>;
}
