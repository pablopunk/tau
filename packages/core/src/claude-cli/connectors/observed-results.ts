import type { ClaudeToolResult } from "../sdk-types";

/** Results of connector calls the CLI ran itself, keyed by tool use id. Owner A implements it. */
export interface ObservedResultStore {
  /** Resolves the waiter, or stores the result when nobody waits yet. Never reaches the CLI. */
  settle(toolUseId: string, result: ClaudeToolResult): void;
  /** Resolves with the result unchanged; rejects `aborted` when the signal fires. */
  wait(toolUseId: string, signal: AbortSignal): Promise<ClaudeToolResult>;
  /** The call is over: drops the entry. */
  forget(toolUseId: string): void;
  isConnectorCall(toolUseId: string): boolean;
}

const NOT_IMPLEMENTED_RESULT: ClaudeToolResult = {
  content: [{ type: "text", text: "Claude connectors are not available yet." }],
  isError: true,
};

export function createObservedResultStore(): ObservedResultStore {
  return {
    settle: () => undefined,
    wait: async () => NOT_IMPLEMENTED_RESULT,
    forget: () => undefined,
    isConnectorCall: () => false,
  };
}
