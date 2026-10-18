import type { Message, Tool } from "@earendil-works/pi-ai";
import { textOfBlocks } from "./normalize";

export interface SystemState {
  readonly prompt: string;
  readonly tools: readonly Tool[];
}

/** Replays every system message in order, as pi-ai defines it. */
export function readSystemState(messages: readonly Message[]): SystemState {
  const contents: string[] = [];
  const sections = new Map<string, string>();
  const tools = new Map<string, Tool>();
  for (const message of messages) {
    if (message.role !== "system") continue;
    contents.push(textOfBlocks(message.content));
    for (const [name, text] of Object.entries(message.sections ?? {})) {
      if (text === null) sections.delete(name);
      else sections.set(name, text);
    }
    for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool);
    for (const removed of message.toolsRemoved ?? []) tools.delete(removed.name);
  }
  const prompt = [...contents, ...sections.values()].filter((part) => part.length > 0).join("\n\n");
  return { prompt, tools: [...tools.values()] };
}
