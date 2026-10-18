import { isNotificationText } from "@tau/protocol";
import type { Entries } from "./run-analysis";

export const JUDGE_BUDGET_CHARS = 60_000;
const TOOL_RESULT_LIMIT = 3000;
const OMITTED = "[earlier part of the transcript left out]\n";

type Block = { type?: string; text?: string; name?: string; arguments?: unknown };
type Message = { role?: string; content?: unknown; toolName?: string };

const blocksOf = (content: unknown): Block[] => (Array.isArray(content) ? (content as Block[]) : []);

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return blocksOf(content)
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

const clip = (text: string, limit: number) => (text.length <= limit ? text : `${text.slice(0, limit)}…`);

function assistantLines(message: Message): string[] {
  const lines: string[] = [];
  const text = textOf(message.content).trim();
  if (text) lines.push(`assistant: ${text}`);
  for (const block of blocksOf(message.content)) {
    if (block.type === "toolCall")
      lines.push(`  > ${block.name ?? "tool"} ${clip(JSON.stringify(block.arguments ?? {}), 400)}`);
  }
  return lines;
}

function linesOf(message: Message): string[] {
  const text = textOf(message.content).trim();
  if (message.role === "user") return [isNotificationText(text) ? `notification: ${text}` : `user: ${text}`];
  if (message.role === "assistant") return assistantLines(message);
  if (message.role === "toolResult")
    return [`  < ${message.toolName ?? "tool"} result: ${clip(text, TOOL_RESULT_LIMIT)}`];
  return [];
}

/** The thread as plain text, including tool results: the judge needs them as evidence. */
export function transcriptOf(entries: Entries): string {
  return entries
    .map((entry) => entry.model?.[0] as Message | undefined)
    .flatMap((message) => (message ? linesOf(message) : []))
    .join("\n");
}

/** The condition in full, then the newest part of the transcript, in at most `budget` characters. */
export function judgeInput(condition: string, transcript: string, budget = JUDGE_BUDGET_CHARS): string {
  const head = `Condition:\n${condition}\n\nTranscript:\n`;
  const room = Math.max(0, budget - head.length);
  if (transcript.length <= room) return head + transcript;
  const tail = transcript.slice(transcript.length - Math.max(0, room - OMITTED.length));
  return head + OMITTED + tail;
}
