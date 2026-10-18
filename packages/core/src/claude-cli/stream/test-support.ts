import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Message,
  Model,
  SimpleStreamOptions,
  Tool,
  ToolCall,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ClaudeCliClock } from "../clock";
import type { RateLimitInfo } from "../plan-usage";
import type { ClaudeSdkPort } from "../sdk-types";
import {
  createFakeClaudeSdk,
  type FakeClaudeSdk,
  type FakeClaudeSdkOptions,
} from "../testing/fake-claude-sdk";
import { type ClaudeCliStreamer, createClaudeCliStream } from "./claude-cli-stream";

export interface ManualClock extends ClaudeCliClock {
  advance(ms: number): void;
}

export function createManualClock(): ManualClock {
  let now = 1_000_000;
  const timers = new Map<number, { at: number; run: () => void }>();
  let next = 0;
  return {
    now: () => now,
    setTimer(run, delayMs) {
      next += 1;
      const id = next;
      timers.set(id, { at: now + delayMs, run });
      return () => void timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.run();
      }
    },
  };
}

export const getWord = {
  name: "get_word",
  description: "a word",
  parameters: { type: "object", properties: {} },
} as unknown as Tool;
export const getNumber = {
  name: "get_number",
  description: "a number",
  parameters: { type: "object", properties: {} },
} as unknown as Tool;

export const FAKE_MODEL = {
  id: "haiku",
  name: "Haiku",
  api: "claude-cli",
  provider: "claude-cli",
  baseUrl: "",
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  reasoning: true,
  contextWindow: 200_000,
  maxTokens: 8000,
} as unknown as Model<Api>;

export const modelNamed = (id: string): Model<Api> => ({ ...FAKE_MODEL, id }) as Model<Api>;

export const systemMessage = (tools: readonly Tool[] = [getWord, getNumber], prompt = "prompt"): Message => ({
  role: "system",
  content: prompt,
  toolsAdded: [...tools],
  timestamp: 1,
});

export const userMessage = (text: string): Message => ({ role: "user", content: text, timestamp: 2 });

export const toolResultFor = (call: ToolCall, text: string, isError = false): Message => ({
  role: "toolResult",
  toolCallId: call.id,
  toolName: call.name,
  content: [{ type: "text", text }],
  isError,
  timestamp: 3,
});

export const toolCallsOf = (message: AssistantMessage): ToolCall[] =>
  message.content.filter((block): block is ToolCall => block.type === "toolCall");

export const contextOf = (messages: Message[]) => ({ messages }) as unknown as TranscriptContext;

export interface Harness {
  readonly fake: FakeClaudeSdk;
  readonly streamer: ClaudeCliStreamer;
  readonly clock: ManualClock;
  readonly usage: RateLimitInfo[];
  readonly authErrors: number[];
  readonly processCounts: number[];
  readonly contextWindows: [string, number][];
}

export interface HarnessOptions extends FakeClaudeSdkOptions {
  readonly env?: Record<string, string | undefined>;
  readonly wrap?: (port: ClaudeSdkPort) => ClaudeSdkPort;
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const fake = createFakeClaudeSdk(options);
  const clock = createManualClock();
  const usage: RateLimitInfo[] = [];
  const authErrors: number[] = [];
  const processCounts: number[] = [];
  const contextWindows: [string, number][] = [];
  const port = options.wrap ? options.wrap(fake.port) : fake.port;
  const streamer = createClaudeCliStream({
    sdk: async () => port,
    planUsage: { current: () => null, record: (info) => void usage.push(info) },
    clock,
    env: options.env ?? { PATH: "/bin" },
    noteContextWindow: (value, window) => void contextWindows.push([value, window]),
    onAuthError: () => void authErrors.push(1),
    onProcessCount: (count) => void processCounts.push(count),
  });
  return { fake, streamer, clock, usage, authErrors, processCounts, contextWindows };
}

export interface Answer {
  readonly events: AssistantMessageEvent[];
  readonly message: AssistantMessage;
}

export async function ask(
  harness: Harness,
  messages: Message[],
  options: SimpleStreamOptions = { sessionId: "thread-1" },
  model: Model<Api> = FAKE_MODEL,
): Promise<Answer> {
  const stream = harness.streamer.streamSimple(model, contextOf(messages), options);
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return { events, message: await stream.result() };
}

export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

export async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400 && !predicate(); attempt++) await tick();
  if (!predicate()) throw new Error("waitFor timed out");
}

export const textOfMessage = (message: AssistantMessage): string =>
  message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
