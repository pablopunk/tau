import type {
  ClaudeQuery,
  ClaudeQueryOptions,
  ClaudeSdkMessage,
  ClaudeToolResult,
  ClaudeUserMessage,
} from "../sdk-types";
import { TOOL_NAME_PREFIX } from "../tool-server";
import {
  type ApiMessage,
  apiMessageEvents,
  initEvent,
  type MessageIds,
  rateLimitEvent,
  resultEvent,
  toolResultEvent,
} from "./fake-claude-events";
import { FAKE_CLAUDE_MODELS } from "./fake-claude-models";
import type { FakeScript, FakeStep, FakeToolUse } from "./fake-claude-script";
import { createMessageChannel } from "./message-channel";

export interface FoldRecord {
  readonly turnIndex: number;
  readonly texts: readonly string[];
}

export interface QueryRecord {
  readonly options: ClaudeQueryOptions;
  sessionId: string;
  readonly inputs: string[];
  readonly folded: FoldRecord[];
  readonly toolCalls: { name: string; toolUseId: string; arguments: Record<string, unknown> }[];
  readonly toolResults: { toolUseId: string; text: string; isError: boolean }[];
  readonly models: string[];
  readonly flags: Record<string, unknown>[];
  interrupts: number;
  closed: boolean;
}

export interface FakeQueryDeps {
  readonly options: ClaudeQueryOptions;
  readonly record: QueryRecord;
  readonly script: FakeScript;
  readonly ids: MessageIds;
  readonly apiKeySource: string;
}

const INTERRUPTED_TEXT = "The tool call was interrupted by the user.";

const textOfInput = (message: ClaudeUserMessage): string =>
  typeof message.message.content === "string"
    ? message.message.content
    : message.message.content.map((block) => (block.type === "text" ? block.text : "[image]")).join("\n");

const resolvedModel = (model: string): string =>
  FAKE_CLAUDE_MODELS.find((row) => row.value === model)?.resolvedModel ?? model;

const textOfResult = (result: ClaudeToolResult): string =>
  result.content.map((block) => (block.type === "text" ? block.text : "[image]")).join("\n");

const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));

export function createFakeQuery(deps: FakeQueryDeps): ClaudeQuery {
  const { options, record, script, ids } = deps;
  const out = createMessageChannel<ClaudeSdkMessage>();
  const pending: string[] = [];
  let model = options.model;
  let turnIndex = 0;
  let initSent = false;
  let inputDone = false;
  let wake: (() => void) | undefined;
  let interruptTurn: (() => void) | undefined;
  let turnInterrupted: Promise<"interrupted"> | undefined;

  const emit = (message: ClaudeSdkMessage) => out.push(message);
  const sessionId = () => record.sessionId;

  async function readInput(): Promise<void> {
    if (typeof options.prompt === "string") {
      pending.push(options.prompt);
      record.inputs.push(options.prompt);
      inputDone = true;
      return;
    }
    for await (const message of options.prompt) {
      const text = textOfInput(message);
      record.inputs.push(text);
      pending.push(text);
      wake?.();
    }
    inputDone = true;
  }

  const emitApiMessage = (
    blocks: ApiMessage["blocks"],
    stopReason: ApiMessage["stopReason"],
    error?: string,
  ) => {
    const message: ApiMessage = {
      id: ids.messageId(),
      model: resolvedModel(model),
      blocks,
      stopReason,
      error,
    };
    for (const event of apiMessageEvents(sessionId(), message, ids)) emit(event);
  };

  const emitResult = (outcome: "success" | "interrupted" | "error") =>
    emit(resultEvent(sessionId(), resolvedModel(model), outcome, ids.uuid()));

  function foldPending(): void {
    if (pending.length === 0) return;
    record.folded.push({ turnIndex, texts: pending.splice(0) });
  }

  async function runTool(use: FakeToolUse, toolUseId: string): Promise<ClaudeToolResult | "interrupted"> {
    const host = options.toolHost;
    if (!host) throw new Error("The fake SDK got a tool call but no tool host.");
    const args = use.arguments ?? {};
    record.toolCalls.push({ name: use.name, toolUseId, arguments: args });
    const call = host.callTool({ name: use.name, arguments: args, toolUseId });
    return turnInterrupted ? Promise.race([call, turnInterrupted]) : call;
  }

  function emitToolResult(toolUseId: string, text: string, isError: boolean): void {
    record.toolResults.push({ toolUseId, text, isError });
    emit(toolResultEvent(sessionId(), toolUseId, text, isError, ids.uuid()));
  }

  async function runToolsStep(
    step: Extract<FakeStep, { kind: "tools" }>,
  ): Promise<"continue" | "interrupted"> {
    const uses = step.calls.map((call) => ({ call, toolUseId: ids.toolUseId() }));
    const blocks = uses.map(({ call, toolUseId }) => ({
      type: "tool_use" as const,
      id: toolUseId,
      name: `${TOOL_NAME_PREFIX}${call.name}`,
      input: call.arguments ?? {},
    }));
    emitApiMessage(
      [...(step.text ? [{ type: "text" as const, text: step.text }] : []), ...blocks],
      "tool_use",
    );
    for (const [index, { call, toolUseId }] of uses.entries()) {
      const result = await runTool(call, toolUseId);
      if (result === "interrupted") {
        for (const open of uses.slice(index)) emitToolResult(open.toolUseId, INTERRUPTED_TEXT, true);
        return "interrupted";
      }
      emitToolResult(toolUseId, textOfResult(result), result.isError);
    }
    return "continue";
  }

  async function runStep(step: FakeStep): Promise<"continue" | "ended" | "interrupted"> {
    if (step.kind === "rateLimit") {
      emit(rateLimitEvent(sessionId(), step.limit, ids.uuid()));
      return "continue";
    }
    if (step.kind === "text") {
      const thinking = step.thinking ? [{ type: "thinking" as const, thinking: step.thinking }] : [];
      emitApiMessage([...thinking, { type: "text", text: step.text }], "end_turn");
      emitResult("success");
      return "ended";
    }
    if (step.kind === "error") {
      emitApiMessage([{ type: "text", text: step.text ?? step.code }], "end_turn", step.code);
      emitResult("error");
      return "ended";
    }
    return runToolsStep(step);
  }

  async function runTurn(firstUserText: string): Promise<void> {
    turnInterrupted = new Promise((resolve) => {
      interruptTurn = () => resolve("interrupted");
    });
    if (!initSent) {
      initSent = true;
      const names = (options.toolHost?.listTools() ?? []).map((tool) => `${TOOL_NAME_PREFIX}${tool.name}`);
      emit(initEvent(sessionId(), resolvedModel(model), names, deps.apiKeySource));
    }
    const steps = script(turnIndex, firstUserText);
    for (const step of steps) {
      await nextTick();
      const outcome = await runStep(step);
      if (outcome === "interrupted") return void emitResult("interrupted");
      if (outcome === "ended") return;
      foldPending();
    }
    emitResult("success");
  }

  async function drive(): Promise<void> {
    while (!record.closed) {
      while (pending.length === 0 && !record.closed && !inputDone)
        await new Promise<void>((resolve) => (wake = resolve));
      const first = pending.shift();
      if (first === undefined) return;
      await runTurn(first);
      turnIndex += 1;
      interruptTurn = undefined;
    }
  }

  void readInput().finally(() => wake?.());
  void drive().finally(() => out.end());

  return {
    [Symbol.asyncIterator]: () => out[Symbol.asyncIterator](),
    async interrupt() {
      record.interrupts += 1;
      interruptTurn?.();
    },
    async setModel(next) {
      record.models.push(next);
      model = next;
    },
    async applyFlagSettings(settings) {
      record.flags.push({ ...settings });
    },
    async isAutoCompactEnabled() {
      return options.settings.autoCompactEnabled !== false;
    },
    close() {
      record.closed = true;
      wake?.();
      interruptTurn?.();
      out.end();
    },
  };
}
