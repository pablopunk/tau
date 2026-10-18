import type { ClaudeCliState, ClaudeCliStatus } from "@tau/protocol";

export const claudeCliStatusOf = (
  state: ClaudeCliState,
  fields: Partial<Omit<ClaudeCliStatus, "state">> = {},
): ClaudeCliStatus => ({
  state,
  plan: null,
  org: null,
  cliVersion: null,
  sdkCliVersion: null,
  message: null,
  usage: null,
  processCount: 0,
  connectors: null,
  ...fields,
});

export const isClaudeCliReady = (status: ClaudeCliStatus): boolean => status.state === "ready";
