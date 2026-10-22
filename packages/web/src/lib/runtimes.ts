import type { ExecutorAvailability, RuntimeDescriptorList } from "@tau/protocol";

/** The Claude Code entry only when the node says it is enabled; a missing, old or malformed answer is `undefined`. */
export function enabledClaudeCode(list: RuntimeDescriptorList | undefined): ExecutorAvailability | undefined {
  const executors = Array.isArray(list?.executors) ? list.executors : [];
  return executors.find((item) => item.executor === "claude-code" && item.enabled === true);
}
