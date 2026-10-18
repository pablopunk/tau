import { isNotificationText } from "@tau/protocol";

export type Entries = readonly { id: unknown; kind: string; model?: readonly unknown[] }[];

type Block = { type?: string; text?: string };
type MessageLike = {
  role?: string;
  content?: unknown;
  stopReason?: string;
  errorMessage?: string;
  usage?: { totalTokens?: number };
};

export interface RunFacts {
  readonly usedTool: boolean;
  readonly tokens: number;
  /** The run holds a message the user typed, not only continuations or notifications. */
  readonly startedByUser: boolean;
  readonly errorMessage: string | undefined;
}

const messageOf = (entry: Entries[number]) => entry.model?.[0] as MessageLike | undefined;

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Block[]).map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("\n");
};

const callsATool = (message: MessageLike | undefined) =>
  message?.role === "assistant" &&
  Array.isArray(message.content) &&
  (message.content as Block[]).some((block) => block.type === "toolCall");

const isUserTyped = (entry: Entries[number] | undefined) => {
  if (!entry || entry.kind !== "pi.user") return false;
  const message = messageOf(entry);
  return message?.role === "user" && !isNotificationText(textOf(message.content));
};

export const lastEntryIdOf = (entries: Entries): string | null => {
  const last = entries.at(-1);
  return last === undefined ? null : String(last.id);
};

/** The run is the entries from `runStartEntryId` on. */
export function analyzeRun(entries: Entries, runStartEntryId: string | null): RunFacts {
  const start =
    runStartEntryId === null ? -1 : entries.findIndex((entry) => String(entry.id) === runStartEntryId);
  const run = start < 0 ? [] : entries.slice(start);
  const messages = run.map(messageOf);
  const answer = messages.findLast((message) => message?.role === "assistant");
  return {
    usedTool: messages.some(callsATool),
    tokens: messages.reduce((sum, message) => sum + (message?.usage?.totalTokens ?? 0), 0),
    startedByUser: run.some(isUserTyped),
    errorMessage: answer?.stopReason === "error" ? (answer.errorMessage ?? "The run failed.") : undefined,
  };
}
