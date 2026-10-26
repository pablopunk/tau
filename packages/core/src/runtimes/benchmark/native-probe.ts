import {
  type Options,
  type SpawnedProcess,
  type SpawnOptions,
  query as sdkQuery,
} from "@anthropic-ai/claude-agent-sdk";
import type { NativeQueryFn } from "../native/controller";
import { childEnvironment, type OfflineWorld } from "../testing/offline-sandbox";
import type { Marks } from "./stages";

export const NATIVE_MODEL = "claude-sonnet-4-5";
export const NATIVE_ANSWER = "Scripted benchmark answer.";
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const SDK_VARIABLE = /^(CLAUDE_CODE_|CLAUDE_AGENT_SDK)/;
const CREDENTIAL_NAME = /TOKEN|KEY|SECRET|OAUTH|AUTH|PASSWORD/;

type SpawnHook = (options: SpawnOptions) => SpawnedProcess;
type Clock = () => number;

export interface NativeProbes {
  /** Records the launch, first-event and first-text marks of the run whose prompt is `prompt`. */
  watch(prompt: string, marks: Marks): void;
  /** Process ids of every child the SDK spawned through the controller's hook. */
  readonly childPids: readonly number[];
  readonly query: NativeQueryFn;
}

const sdkOwnVariables = (env: SpawnOptions["env"]): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && SDK_VARIABLE.test(entry[0]) && !CREDENTIAL_NAME.test(entry[0]),
    ),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function carriesAssistantText(message: unknown): boolean {
  if (!isRecord(message)) return false;
  if (message.type === "stream_event" && isRecord(message.event) && isRecord(message.event.delta)) {
    return message.event.delta.type === "text_delta";
  }
  if (message.type !== "assistant" || !isRecord(message.message)) return false;
  const content = message.message.content;
  return Array.isArray(content) && content.some((block) => isRecord(block) && block.type === "text");
}

async function* observed(source: AsyncIterable<unknown>, marks: Marks, now: Clock) {
  for await (const message of source) {
    marks.firstEvent ??= now();
    if (carriesAssistantText(message)) marks.firstText ??= now();
    yield message;
  }
}

/** The SDK query, with iteration observed and every other member (interrupt, close) passed through. */
function withObservedIteration<T extends AsyncIterable<unknown>>(source: T, marks: Marks, now: Clock): T {
  return new Proxy(source, {
    get(target, property) {
      if (property === Symbol.asyncIterator) return () => observed(target, marks, now);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const hermeticOptions = (world: OfflineWorld, serverUrl: string): Partial<Options> => ({
  model: NATIVE_MODEL,
  systemPrompt: "You are a test agent.",
  title: "runtime benchmark",
  tools: [],
  settingSources: [],
  strictMcpConfig: true,
  settings: { disableClaudeAiConnectors: true, autoCompactEnabled: false },
  includePartialMessages: true,
  env: childEnvironment(world, serverUrl),
});

function underSandboxExec(
  world: OfflineWorld,
  serverUrl: string,
  hook: SpawnHook,
  pids: number[],
): SpawnHook {
  return (options) => {
    const child = hook({
      ...options,
      command: SANDBOX_EXEC,
      args: ["-f", world.profile, options.command, ...options.args],
      env: { ...sdkOwnVariables(options.env), ...childEnvironment(world, serverUrl) },
    });
    const pid = (child as unknown as { pid?: number }).pid;
    if (pid !== undefined) pids.push(pid);
    return child;
  };
}

/** The real Agent SDK, its process wrapped in sandbox-exec (loopback only), observed for the stage marks. */
export function createNativeProbes(world: OfflineWorld, serverUrl: string, now: Clock): NativeProbes {
  const byPrompt = new Map<string, Marks>();
  const childPids: number[] = [];
  const query: NativeQueryFn = ({ prompt, options }) => {
    const marks = byPrompt.get(prompt) ?? {};
    marks.launch = now();
    const hook = options.spawnClaudeCodeProcess as SpawnHook;
    const sdk = sdkQuery({
      prompt,
      options: {
        ...(options as Options),
        ...hermeticOptions(world, serverUrl),
        spawnClaudeCodeProcess: underSandboxExec(world, serverUrl, hook, childPids),
      },
    });
    return withObservedIteration(sdk, marks, now);
  };
  return {
    watch: (prompt, marks) => {
      byPrompt.set(prompt, marks);
    },
    childPids,
    query,
  };
}
