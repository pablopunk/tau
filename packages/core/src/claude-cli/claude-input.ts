import type { ClaudeContentBlock, ClaudeInputStream, ClaudeUserMessage } from "./sdk-types";

export interface ClaudeInput {
  readonly stream: ClaudeInputStream;
  push(content: string | readonly ClaudeContentBlock[]): void;
  close(): void;
}

const userMessage = (content: string | readonly ClaudeContentBlock[]): ClaudeUserMessage => ({
  type: "user",
  message: { role: "user", content },
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
