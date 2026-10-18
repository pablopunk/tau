import type {
  ClaudeApiContentBlock,
  ClaudeContentBlock,
  ClaudeInputStream,
  ClaudeUserMessage,
} from "./sdk-types";

export interface ClaudeInput {
  readonly stream: ClaudeInputStream;
  push(content: string | readonly ClaudeContentBlock[]): void;
  close(): void;
}

export const toApiBlock = (block: ClaudeContentBlock): ClaudeApiContentBlock =>
  block.type === "image"
    ? { type: "image", source: { type: "base64", media_type: block.mimeType, data: block.data } }
    : block;

const toApiContent = (content: string | readonly ClaudeContentBlock[]) =>
  typeof content === "string" ? content : content.map(toApiBlock);

const userMessage = (content: string | readonly ClaudeContentBlock[]): ClaudeUserMessage => ({
  type: "user",
  message: { role: "user", content: toApiContent(content) },
  parent_tool_use_id: null,
  session_id: "",
});

export function createClaudeInput(): ClaudeInput {
  const queue: ClaudeUserMessage[] = [];
  let closed = false;
  let wake: (() => void) | undefined;
  const signal = () => wake?.();
  async function* stream(): ClaudeInputStream {
    while (true) {
      while (queue.length === 0 && !closed) await new Promise<void>((resolve) => (wake = resolve));
      const next = queue.shift();
      if (next === undefined) return;
      yield next;
    }
  }
  return {
    stream: stream(),
    push(content) {
      if (closed) return;
      queue.push(userMessage(content));
      signal();
    },
    close() {
      closed = true;
      signal();
    },
  };
}
