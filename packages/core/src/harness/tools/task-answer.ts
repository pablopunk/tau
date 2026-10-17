import type { ConversationId, Tx } from "@earendil-works/pi-durable";

const HISTORY_WINDOW = 30;

type TextBlock = { type?: string; text?: string };

function textOf(model: unknown): string {
  const message = (Array.isArray(model) ? model[0] : undefined) as
    | { role?: string; content?: unknown }
    | undefined;
  if (message?.role !== "assistant" || !Array.isArray(message.content)) return "";
  return (message.content as TextBlock[])
    .flatMap((block) => (block.type === "text" ? [block.text ?? ""] : []))
    .join("")
    .trim();
}

/** The newest assistant text of a finished child, or an empty string. */
export async function finalAnswerOf(tx: Tx, childId: ConversationId): Promise<string> {
  const page = await tx.scanEntries({ conversationId: childId }, HISTORY_WINDOW);
  const answer = page.items.map((entry) => (entry.kind === "pi.assistant" ? textOf(entry.model) : ""));
  return answer.find((text) => text !== "") ?? "";
}
