export interface TerminalViewProps {
  /** Raw output bytes to write to the screen. The owner wires the stream. */
  readonly onInput: (data: Uint8Array) => void;
  readonly onResize: (cols: number, rows: number) => void;
}

/** Placeholder (owner C): the one effectful design-system part, xterm.js loaded lazily. */
export function TerminalView(_props: TerminalViewProps) {
  return <div role="region" aria-label="Terminal" />;
}
