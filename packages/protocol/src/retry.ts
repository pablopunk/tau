import type { ConversationView, EntryRecord } from "./view";

const RETRY_ENTRY_KINDS: readonly string[] = ["pi.user", "app.retry", "pi.assistant", "pi.tool-result"];
const FINISHED_STOP_REASONS: readonly string[] = ["stop", "length"];

const isRunning = (view: ConversationView) =>
  (view.docs["pi.live"] as { run?: unknown } | undefined)?.run !== undefined;

function isFinishedAnswer(entry: EntryRecord): boolean {
  const message = entry.model?.[0];
  return (
    entry.kind === "pi.assistant" &&
    message?.role === "assistant" &&
    FINISHED_STOP_REASONS.includes(message.stopReason)
  );
}

export function isRetryable(view: ConversationView): boolean {
  if (isRunning(view)) return false;
  const last = view.entries.filter((entry) => RETRY_ENTRY_KINDS.includes(entry.kind)).at(-1);
  return last !== undefined && !isFinishedAnswer(last);
}
