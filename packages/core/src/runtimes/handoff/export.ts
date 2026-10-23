import {
  type AssistantMessage,
  type ConversationView,
  type EntryRecord,
  emptyHandoffLosses,
  type HandoffLosses,
  type ToolCall,
  type ToolResultMessage,
  type Transcript,
  type TranscriptItem,
  transcriptOf,
  userText,
} from "@tau/protocol";

export const EXPORT_BUDGET_CHARS = 60_000;
export const TOOL_CALL_LINE_MAX = 120;
export const TOOL_RESULT_MAX = 500;
const TOOL_NAME_MAX = 40;
const NOTE_LINE_MAX = 300;
const ERROR_LINE_MAX = 200;
const TURN_SEPARATOR = "\n\n";
const ATTACHMENT_PREFIX = 'Attached file: "';
const TRIMMED_MARKER = "[the beginning of this turn was trimmed to fit the size limit]\n";

export interface ThreadExport {
  readonly text: string;
  readonly losses: HandoffLosses;
}

interface Tally {
  images: number;
  thinking: number;
  truncated: number;
  attachments: number;
}

interface Turn {
  readonly lines: string[];
  readonly tally: Tally;
}

type Block = { readonly type?: string; readonly text?: string };

const newTally = (): Tally => ({ images: 0, thinking: 0, truncated: 0, attachments: 0 });

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

const noteLine = (text: string): string => `[${clip(oneLine(text), NOTE_LINE_MAX)}]`;

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

function toolCallLine(call: ToolCall): string {
  const head = `[tool ${clip(call.name, TOOL_NAME_MAX)}(`;
  const tail = ")]";
  const room = TOOL_CALL_LINE_MAX - head.length - tail.length;
  return `${head}${clip(JSON.stringify(call.arguments ?? {}), room)}${tail}`;
}

function resultLine(message: ToolResultMessage, tally: Tally): string {
  const blocks = message.content as readonly Block[];
  tally.images += blocks.filter((block) => block.type === "image").length;
  const text = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
  const label = message.isError ? "[tool error]" : "[tool result]";
  if (text.length <= TOOL_RESULT_MAX) return text === "" ? `${label} (empty)` : `${label} ${text}`;
  tally.truncated += 1;
  return `${label} ${text.slice(0, TOOL_RESULT_MAX)} …[truncated, ${text.length} chars in total]`;
}

function assistantLines(message: AssistantMessage, transcript: Transcript, tally: Tally): string[] {
  const lines: string[] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      const text = block.text.trim();
      if (text !== "") lines.push(`Assistant: ${text}`);
    } else if (block.type === "thinking") {
      tally.thinking += 1;
    } else if (block.type === "toolCall") {
      lines.push(toolCallLine(block));
      const result = transcript.results.get(block.id);
      if (result) lines.push(resultLine(result.message, tally));
    }
  }
  if (message.stopReason === "error" && message.errorMessage) {
    lines.push(`[error: ${clip(oneLine(message.errorMessage), ERROR_LINE_MAX)}]`);
  }
  return lines;
}

interface UserParts {
  readonly texts: string[];
  readonly images: number;
  readonly attachments: number;
}

const isAttachmentBlock = (block: Block): boolean =>
  block.type === "text" && (block.text ?? "").startsWith(ATTACHMENT_PREFIX);

function userPartsOf(
  item: Extract<TranscriptItem, { kind: "user" }>,
  entries: ReadonlyMap<string, EntryRecord>,
): UserParts {
  const content = (entries.get(item.key)?.model?.[0] as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return { texts: [item.text], images: item.images.length, attachments: 0 };
  const blocks = content as Block[];
  return {
    texts: blocks
      .filter((block) => block.type === "text" && !isAttachmentBlock(block))
      .map((block) => block.text ?? ""),
    images: blocks.filter((block) => block.type === "image").length,
    attachments: blocks.filter(isAttachmentBlock).length,
  };
}

function userLines(
  item: Extract<TranscriptItem, { kind: "user" }>,
  entries: ReadonlyMap<string, EntryRecord>,
  tally: Tally,
): string[] {
  const { texts, images, attachments } = userPartsOf(item, entries);
  tally.images += images;
  tally.attachments += attachments;
  const text = texts.join("\n").trim();
  return [
    ...(text === "" ? [] : [`User: ${text}`]),
    ...(images > 0 ? [`[${plural(images, "image")} omitted]`] : []),
    ...(attachments > 0 ? [`[${plural(attachments, "attached file")} omitted]`] : []),
  ];
}

function compactionLines(item: TranscriptItem, entries: ReadonlyMap<string, EntryRecord>): string[] {
  const message = entries.get(item.key)?.model?.[0];
  const summary = message?.role === "user" ? userText(message).trim() : "";
  return summary === "" ? [] : [`[Summary of earlier context]\n${summary}`];
}

function notificationLines(item: TranscriptItem): string[] {
  switch (item.kind) {
    case "subagent-notification": {
      const verb = item.data.status === "done" ? "finished" : item.data.status;
      return [noteLine(`Subagent "${item.data.title}" ${verb}: ${item.data.report}`)];
    }
    case "monitor-event":
      return [
        noteLine(`Monitor "${item.data.description}" produced ${plural(item.data.lines.length, "line")}`),
      ];
    case "process-exit": {
      const code = typeof item.data.exitCode === "number" ? ` with code ${item.data.exitCode}` : "";
      return [noteLine(`Process "${item.data.name}" exited${code}: ${item.data.command}`)];
    }
    case "timer-fired":
      return [noteLine(`Timer fired: ${item.data.prompt}`)];
    case "notice":
      return [noteLine(`Notice: ${item.data.text}`)];
    case "goal-verdict":
      return [noteLine(`Goal check ${item.data.verdict}: ${item.data.reason}`)];
    case "bang":
      return [noteLine(`User ran: ! ${item.data.command}`)];
    default:
      return [];
  }
}

function linesOf(
  item: TranscriptItem,
  transcript: Transcript,
  entries: ReadonlyMap<string, EntryRecord>,
  tally: Tally,
): string[] {
  if (item.kind === "user") return userLines(item, entries, tally);
  if (item.kind === "assistant") return assistantLines(item.message, transcript, tally);
  if (item.kind === "compaction") return compactionLines(item, entries);
  if (item.kind === "retry") return [];
  return notificationLines(item);
}

function turnsOf(view: ConversationView): Turn[] {
  const transcript = transcriptOf(view);
  const entries = new Map(view.entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
  const turns: Turn[] = [];
  for (const item of transcript.items) {
    if (item.kind === "user" || turns.length === 0) turns.push({ lines: [], tally: newTally() });
    const turn = turns[turns.length - 1] as Turn;
    turn.lines.push(...linesOf(item, transcript, entries, turn.tally));
  }
  return turns.filter((turn) => turn.lines.length > 0);
}

const textOfTurn = (turn: Turn): string => turn.lines.join("\n");

const omittedNote = (count: number): string =>
  `[${plural(count, "earlier turn")} omitted to keep this handoff within ${EXPORT_BUDGET_CHARS} characters]`;

const joinedLength = (texts: readonly string[]): number =>
  texts.reduce((sum, text) => sum + text.length, 0) + Math.max(0, texts.length - 1) * TURN_SEPARATOR.length;

function newestThatFit(texts: readonly string[], room: number): number {
  let first = texts.length;
  let used = 0;
  while (first > 0) {
    const cost = (texts[first - 1] as string).length + (used > 0 ? TURN_SEPARATOR.length : 0);
    if (used + cost > room) break;
    used += cost;
    first -= 1;
  }
  return first;
}

function trimBeginning(text: string, room: number): string {
  return `${TRIMMED_MARKER}${text.slice(text.length - Math.max(0, room - TRIMMED_MARKER.length))}`;
}

const addTally = (sum: Tally, add: Tally): Tally => ({
  images: sum.images + add.images,
  thinking: sum.thinking + add.thinking,
  truncated: sum.truncated + add.truncated,
  attachments: sum.attachments + add.attachments,
});

/**
 * A deterministic text rendering of a Pi thread for a new thread of another executor: no model call, no clock, no
 * randomness. The newest turns win; whole oldest turns are dropped first, behind an explicit leading note.
 */
export function exportThreadContext(view: ConversationView): ThreadExport {
  const turns = turnsOf(view);
  const texts = turns.map(textOfTurn);
  const compactionPresent = view.entries.some((entry) => entry.kind === "pi.compaction");
  if (turns.length === 0) return { text: "", losses: { ...emptyHandoffLosses(), compactionPresent } };
  const fits = joinedLength(texts) <= EXPORT_BUDGET_CHARS;
  const room = EXPORT_BUDGET_CHARS - omittedNote(turns.length).length - TURN_SEPARATOR.length;
  const first = fits ? 0 : Math.min(newestThatFit(texts, room), turns.length - 1);
  const trimmed = !fits && (texts[turns.length - 1] as string).length > room && first === turns.length - 1;
  const keptTexts = texts.slice(first).map((text) => (trimmed ? trimBeginning(text, room) : text));
  const note = first > 0 ? [omittedNote(first)] : [];
  const text = [...note, ...keptTexts].join(TURN_SEPARATOR);
  const tally = turns.slice(first).reduce((sum, turn) => addTally(sum, turn.tally), newTally());
  return {
    text,
    losses: {
      imagesOmitted: tally.images,
      thinkingBlocksOmitted: tally.thinking,
      toolResultsTruncated: tally.truncated,
      turnsDropped: first,
      compactionPresent,
      attachmentsOmitted: tally.attachments,
      partialTurnTrimmed: trimmed,
      exportedChars: text.length,
    },
  };
}
