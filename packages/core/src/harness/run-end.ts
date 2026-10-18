import type { ConversationId, Harness } from "@earendil-works/pi-durable";
import { BACKGROUND } from "./open";

export type RunOutcome = "ok" | "error" | "aborted";

export interface RunEnd {
  readonly conversationId: string;
  readonly outcome: RunOutcome;
  /** The first entry of the run that ended: the entry after the previous final answer. `null` for an empty thread. */
  readonly runStartEntryId: string | null;
}

type Entries = readonly { id: unknown; kind: string; model?: readonly unknown[] }[];

type AssistantLike = { role?: string; stopReason?: string };

const assistantOf = (entry: Entries[number]): AssistantLike | undefined => {
  const message = entry.kind === "pi.assistant" ? (entry.model?.[0] as AssistantLike | undefined) : undefined;
  return message?.role === "assistant" ? message : undefined;
};

const isFinalAnswer = (entry: Entries[number]) => {
  const reason = assistantOf(entry)?.stopReason;
  return reason !== undefined && reason !== "toolUse";
};

const lastMeaningfulIndex = (entries: Entries) =>
  entries.findLastIndex((entry) => entry.kind !== "pi.system");

const endedWithAnswerAt = (entries: Entries): number => {
  const last = lastMeaningfulIndex(entries);
  return last >= 0 && isFinalAnswer(entries[last] as Entries[number]) ? last : -1;
};

/** A run whose last entry is not a final answer was cut short before it: only a Stop does that. */
export function outcomeOf(entries: Entries): RunOutcome {
  const answer = entries[endedWithAnswerAt(entries)];
  if (answer === undefined) return "aborted";
  const reason = assistantOf(answer)?.stopReason;
  if (reason === "error") return "error";
  return reason === "aborted" ? "aborted" : "ok";
}

export function runStartOf(entries: Entries): string | null {
  const answerAt = endedWithAnswerAt(entries);
  const before = answerAt >= 0 ? answerAt : entries.length;
  const boundary = entries.findLastIndex((entry, index) => index < before && isFinalAnswer(entry));
  const start = entries[boundary + 1];
  return start === undefined ? null : String(start.id);
}

export async function readRunEnd(harness: Harness, id: ConversationId): Promise<RunEnd> {
  const conversation = await harness.conversation(id, BACKGROUND);
  const entries: Entries = conversation ? (await conversation.context(BACKGROUND)).entries : [];
  return { conversationId: String(id), outcome: outcomeOf(entries), runStartEntryId: runStartOf(entries) };
}
