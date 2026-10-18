import { SUBAGENT_NOTIFICATION_KIND } from "./entities";
import { isNotificationText } from "./mvp8";
import type { ConversationView, EntryRecord } from "./view";

const TOOL_ARGUMENT_LIMIT = 80;

type Block = { type?: string; text?: string; name?: string; arguments?: unknown };

const blocksOf = (content: unknown): Block[] => (Array.isArray(content) ? (content as Block[]) : []);

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return blocksOf(content)
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

const truncate = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;

const toolLineOf = (block: Block): string => {
  const args = truncate(JSON.stringify(block.arguments ?? {}), TOOL_ARGUMENT_LIMIT);
  return `  > ${block.name ?? "tool"} ${args}`;
};

function assistantLinesOf(content: unknown): string[] {
  const lines: string[] = [];
  const text = textOf(content).trim();
  if (text) lines.push(`assistant: ${text}`);
  for (const block of blocksOf(content)) if (block.type === "toolCall") lines.push(toolLineOf(block));
  return lines;
}

function notificationLineOf(data: unknown): string | undefined {
  const note = data as { title?: string; status?: string; report?: string } | undefined;
  if (!note || typeof note.title !== "string" || typeof note.status !== "string") return undefined;
  const verb = note.status === "done" ? "finished" : note.status;
  return `notification: subagent "${note.title}" ${verb}: ${note.report ?? ""}`.trimEnd();
}

function linesOf(entry: EntryRecord): string[] {
  if (entry.kind === SUBAGENT_NOTIFICATION_KIND) {
    const line = notificationLineOf(entry.data);
    return line ? [line] : [];
  }
  const message = entry.model?.[0];
  if (entry.kind === "pi.user" && message?.role === "user") {
    const text = textOf(message.content).trim();
    return isNotificationText(text) ? [] : [`user: ${text}`];
  }
  if (entry.kind === "pi.assistant" && message?.role === "assistant")
    return assistantLinesOf(message.content);
  if (entry.kind === "pi.compaction") return ["(context compacted)"];
  return [];
}

/** The text of the last assistant message of a view, or an empty string. */
export function lastAssistantText(view: ConversationView): string {
  for (const entry of [...view.entries].reverse()) {
    const message = entry.model?.[0];
    if (entry.kind === "pi.assistant" && message?.role === "assistant") {
      const text = textOf(message.content).trim();
      if (text) return text;
    }
  }
  return "";
}

/** Renders a view as plain text for `tau threads read` and `--wait`. `last` keeps the final N messages. */
export function viewToText(view: ConversationView, options: { readonly last?: number } = {}): string {
  const messages = view.entries.map(linesOf).filter((lines) => lines.length > 0);
  const kept = options.last === undefined ? messages : messages.slice(-options.last);
  return kept.map((lines) => lines.join("\n")).join("\n\n");
}
