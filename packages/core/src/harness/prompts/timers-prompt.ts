import type { PromptInput, PromptSection } from "@earendil-works/pi-durable";
import { ConversationDoc, ProjectIndexDoc } from "../conversation-docs";

type Context = Parameters<PromptSection["render"]>[1];

export const TIMERS_PROMPT = [
  "Timers: you can come back later on your own, so never poll or sleep in a command.",
  "- schedule_wakeup({ delay_seconds, prompt, reason }) wakes this thread once, 60 s to 24 h from now.",
  '- schedule_repeat({ every, prompt }) wakes it at a fixed interval ("5m", "2h", "1d"; at least 1m). A repeat expires after 7 days.',
  "- timers_list shows this thread's timers; timer_delete({ id }) removes one. At most 20 timers per thread.",
  "A timer arrives as a <timer-fired> notification holding your prompt. Act on it, then stop; if the work is done, delete the repeat. At most one wake-up per timer waits at a time.",
  "When the user runs /loop without an interval, end each turn with schedule_wakeup using the delay that fits (at least 5 min unless asked for less), or stop by not calling it.",
].join("\n");

/** Subagents never get timers, so their prompt leaves the section out. */
export async function renderTimersSection(input: PromptInput, context: Context) {
  const meta = await input.read.snapshot(ConversationDoc, input.conversationId, context);
  if (!meta?.projectId) return TIMERS_PROMPT;
  const index = await input.read.snapshot(ProjectIndexDoc, meta.projectId, context);
  const entry = index?.conversations.find(
    (candidate) => candidate.conversationId === Number(input.conversationId),
  );
  return entry?.parentId === undefined ? TIMERS_PROMPT : undefined;
}
