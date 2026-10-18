import type { TerminalServerFrame } from "@tau/protocol";

export interface TerminalStreamState {
  readonly status: "connecting" | "ready" | "exited" | "closed";
  readonly exitCode: number | null;
}

export type { TerminalServerFrame };

/** Placeholder (owner C): opens `terminalStreamPath(id)` through `Transport.openStream` and drives the TerminalView. */
export function useTerminalStream(_terminalId: string): TerminalStreamState {
  return { status: "connecting", exitCode: null };
}
