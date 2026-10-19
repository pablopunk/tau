import { readFileSync } from "node:fs";
import type { Message } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";

export interface FauxReplyStep {
  readonly thinking?: string;
  readonly text?: string;
  /** Several calls in one step run side by side, like parallel subagents. */
  readonly tools?: readonly { readonly name: string; readonly arguments: Record<string, unknown> }[];
}

/** Prompt (exact text) to the assistant messages that answer it: one per model call, so parallel tool calls share a step. */
export type FauxReplies = Readonly<Record<string, readonly FauxReplyStep[]>>;

export function loadFauxReplies(file: string | undefined): FauxReplies | undefined {
  return file ? (JSON.parse(readFileSync(file, "utf8")) as FauxReplies) : undefined;
}

function repliesAfter(messages: readonly Message[], userIndex: number): number {
  return messages.slice(userIndex + 1).filter((message) => message.role === "assistant").length;
}

/** The scripted assistant message for the last user prompt, when `replies` has one for its text and step. */
export function scriptedStep(
  replies: FauxReplies,
  messages: readonly Message[],
  promptOf: (message: Message) => string,
) {
  const userIndex = messages.map((message) => message.role).lastIndexOf("user");
  const user = messages[userIndex];
  const step = user && replies[promptOf(user)]?.[repliesAfter(messages, userIndex)];
  if (!step) return undefined;
  const parts = [
    ...(step.thinking ? [fauxThinking(step.thinking)] : []),
    ...(step.text ? [fauxText(step.text)] : []),
    ...(step.tools ?? []).map((tool) => fauxToolCall(tool.name, tool.arguments as never)),
  ];
  return fauxAssistantMessage(parts, step.tools?.length ? { stopReason: "toolUse" } : undefined);
}
