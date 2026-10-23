import {
  type ConversationSummary,
  type ConversationView,
  type ExecutorKind,
  executorOf,
  nativeAttachmentsError,
  nativeEventsOf,
} from "@tau/protocol";

export const NATIVE_LABEL = "Claude Code";

export const isNativeExecutor = (executor: ExecutorKind | undefined): boolean =>
  executorOf({ executor }) !== "pi";

/** The summary names a native thread; a view that already holds native events does too, before the summary arrives. */
export function threadExecutorOf(
  summary: Pick<ConversationSummary, "executor"> | undefined,
  view: ConversationView | undefined,
): ExecutorKind | undefined {
  if (summary?.executor !== undefined) return summary.executor;
  return view !== undefined && nativeEventsOf(view).length > 0 ? "claude-code" : undefined;
}

const sentenceOf = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

export const NATIVE_ATTACHMENTS_REASON = sentenceOf(nativeAttachmentsError().message);
