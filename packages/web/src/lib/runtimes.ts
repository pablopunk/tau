import type { ExecutorAvailability, RuntimeDescriptorList } from "@tau/protocol";

/** The Claude Code entry only when the node says it is enabled; a missing, old or malformed answer is `undefined`. */
export function enabledClaudeCode(list: RuntimeDescriptorList | undefined): ExecutorAvailability | undefined {
  const executors = Array.isArray(list?.executors) ? list.executors : [];
  return executors.find((item) => item.executor === "claude-code" && item.enabled === true);
}

const sentenceOf = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

const CLAUDE_CODE_DISABLED_FALLBACK = "Claude Code is not installed on this node";

/** Why a native thread cannot take new messages; `undefined` while the node has not said Claude Code is disabled. */
export function claudeCodeDisabledReason(list: RuntimeDescriptorList | undefined): string | undefined {
  const executors = Array.isArray(list?.executors) ? list.executors : [];
  const entry = executors.find((item) => item.executor === "claude-code");
  if (entry === undefined || entry.enabled !== false) return undefined;
  return sentenceOf(entry.reason ?? CLAUDE_CODE_DISABLED_FALLBACK);
}
