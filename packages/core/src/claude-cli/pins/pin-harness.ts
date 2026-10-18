import type {
  ClaudeQuery,
  ClaudeSdkMessage,
  ClaudeToolDefinition,
  ClaudeToolHost,
  ClaudeToolResult,
} from "../sdk-types";

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  readonly settledAt: () => number | null;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let settled: number | null = null;
  const promise = new Promise<T>((done) => {
    resolve = (value) => {
      settled ??= Date.now();
      done(value);
    };
  });
  return { promise, resolve, settledAt: () => settled };
}

const textResult = (text: string): ClaudeToolResult => ({
  content: [{ type: "text", text }],
  isError: false,
});

export interface HandlerCall {
  readonly name: string;
  readonly toolUseId: string;
  readonly invokedAt: number;
  returnedAt: number | null;
}

export interface PinHost extends ClaudeToolHost {
  readonly calls: HandlerCall[];
  /** The deferred is get-or-create, so a result may arrive before or after its handler is called. */
  deferredFor(toolUseId: string): Deferred<ClaudeToolResult>;
  addTool(tool: ClaudeToolDefinition): void;
}

const emptyObjectSchema = { type: "object", properties: {} };

export const pinTool = (name: string): ClaudeToolDefinition => ({
  name,
  description: `Returns the secret ${name.replace("get_", "")}.`,
  inputSchema: emptyObjectSchema,
});

export function createPinHost(initial: readonly ClaudeToolDefinition[]): PinHost {
  const tools = [...initial];
  const listeners = new Set<() => void>();
  const deferreds = new Map<string, Deferred<ClaudeToolResult>>();
  const calls: HandlerCall[] = [];
  const deferredFor = (id: string) => {
    let deferred = deferreds.get(id);
    if (!deferred) {
      deferred = createDeferred();
      deferreds.set(id, deferred);
    }
    return deferred;
  };
  return {
    calls,
    deferredFor,
    listTools: () => tools,
    addTool(tool) {
      tools.push(tool);
      for (const listener of listeners) listener();
    },
    onToolsChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async callTool(call) {
      const record: HandlerCall = {
        name: call.name,
        toolUseId: call.toolUseId,
        invokedAt: Date.now(),
        returnedAt: null,
      };
      calls.push(record);
      const result = await deferredFor(call.toolUseId).promise;
      record.returnedAt = Date.now();
      return result;
    },
  };
}

export const resolveWith = (deferred: Deferred<ClaudeToolResult>, text: string) =>
  deferred.resolve(textResult(text));

export interface TimedMessage {
  readonly at: number;
  readonly message: ClaudeSdkMessage;
}

export interface Recorder {
  readonly messages: TimedMessage[];
  /** Resolves with the first match at or after index `since`, or rejects after `timeoutMs`. */
  waitFor(
    predicate: (message: ClaudeSdkMessage) => boolean,
    timeoutMs: number,
    label: string,
    since?: number,
  ): Promise<ClaudeSdkMessage>;
  count(predicate: (message: ClaudeSdkMessage) => boolean): number;
}

export function record(query: ClaudeQuery): Recorder {
  const messages: TimedMessage[] = [];
  const waiters = new Set<() => void>();
  const wakeAll = () => {
    for (const wake of waiters) wake();
  };
  void (async () => {
    try {
      for await (const message of query) {
        messages.push({ at: Date.now(), message });
        wakeAll();
      }
    } catch {
      wakeAll();
    }
  })();
  return {
    messages,
    count: (predicate) => messages.filter((entry) => predicate(entry.message)).length,
    waitFor(predicate, timeoutMs, label, since = 0) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const found = messages.slice(since).find((entry) => predicate(entry.message));
          if (!found) return;
          cleanup();
          resolve(found.message);
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out after ${timeoutMs} ms waiting for ${label}`));
        }, timeoutMs);
        const cleanup = () => {
          clearTimeout(timer);
          waiters.delete(check);
        };
        waiters.add(check);
        check();
      });
    },
  };
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const isResult = (message: ClaudeSdkMessage) => message.type === "result";

export const isInit = (message: ClaudeSdkMessage) => message.type === "system" && message.subtype === "init";

export function textOf(message: ClaudeSdkMessage): string {
  const content =
    (message.message as { content?: { type: string; text?: string }[] } | undefined)?.content ?? [];
  return content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
}

export const assistantTexts = (recorder: Recorder): string[] =>
  recorder.messages
    .filter(({ message }) => message.type === "assistant")
    .map(({ message }) => textOf(message));

export interface ToolUseBlock {
  readonly id: string;
  readonly name: string;
}

export function toolUsesOf(message: ClaudeSdkMessage): ToolUseBlock[] {
  const content =
    (message.message as { content?: { type: string; id?: string; name?: string }[] } | undefined)?.content ??
    [];
  return content.flatMap((block) =>
    block.type === "tool_use" && block.id && block.name ? [{ id: block.id, name: block.name }] : [],
  );
}

export async function pollUntil(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${label}`);
    await sleep(50);
  }
}

export const toolUsesIn = (recorder: Recorder): ToolUseBlock[] =>
  recorder.messages.flatMap(({ message }) => (message.type === "assistant" ? toolUsesOf(message) : []));

export const resultTextOf = (message: ClaudeSdkMessage): string => String(message.result ?? "");
