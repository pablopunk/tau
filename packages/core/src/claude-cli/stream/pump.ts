import { isConnectorToolName } from "../connectors/names";
import type { RateLimitInfo } from "../plan-usage";
import type { ClaudeQuery, ClaudeSdkMessage } from "../sdk-types";
import type { Binding } from "./binding";
import { toolResultsOf } from "./connector-results";
import { API_KEY_STOPPED_TEXT, neutralText, planLimitText } from "./errors";
import { closeQuery, noteResultSeen } from "./lifecycle";
import type { Runtime } from "./runtime";
import type { Turn } from "./turn";

function stopForApiKey(rt: Runtime, binding: Binding): void {
  const listener = binding.listener;
  closeQuery(rt, binding);
  listener?.fail(API_KEY_STOPPED_TEXT);
}

function onSystem(rt: Runtime, binding: Binding, message: ClaudeSdkMessage): void {
  if (message.subtype === "init" && message.apiKeySource !== "none") stopForApiKey(rt, binding);
}

function onRateLimit(rt: Runtime, binding: Binding, message: ClaudeSdkMessage): void {
  const info = message.rate_limit_info as RateLimitInfo | undefined;
  if (!info) return;
  rt.deps.planUsage.record(info);
  if (typeof info.resetsAt === "number") binding.latestResetsAt = info.resetsAt;
  const listener = binding.listener;
  if (info.status === "rejected" && listener && !listener.isSettled()) {
    listener.fail(planLimitText(binding.latestResetsAt), "limit");
  }
}

function noteContextWindows(rt: Runtime, binding: Binding, message: ClaudeSdkMessage): void {
  const usage = message.modelUsage as Record<string, { contextWindow?: number }> | undefined;
  for (const entry of Object.values(usage ?? {})) {
    if (typeof entry.contextWindow === "number")
      rt.deps.noteContextWindow(binding.model, entry.contextWindow);
  }
}

const activeListener = (binding: Binding): Turn | null =>
  binding.listener && !binding.listener.isSettled() ? binding.listener : null;

function onResult(rt: Runtime, binding: Binding, message: ClaudeSdkMessage): void {
  noteContextWindows(rt, binding, message);
  if (noteResultSeen(binding)) return;
  const listener = activeListener(binding);
  if (listener) listener.onResult(message);
  else binding.resultSeen = true;
}

function routeConnectorResults(rt: Runtime, binding: Binding, message: ClaudeSdkMessage): boolean {
  const connectorResults = toolResultsOf(message).filter(({ toolUseId }) =>
    binding.connectorIds.has(toolUseId),
  );
  for (const { toolUseId, result } of connectorResults) {
    binding.openConnectorIds.delete(toolUseId);
    binding.connectorTail = true;
    rt.deps.observed?.settle(toolUseId, result);
  }
  return connectorResults.length > 0;
}

interface ToolUseBlock {
  readonly type?: string;
  readonly id?: string;
  readonly name?: string;
}

const toolUseBlocksOf = (message: ClaudeSdkMessage): ToolUseBlock[] => {
  if (message.type === "stream_event") {
    const block = (message.event as { content_block?: ToolUseBlock } | undefined)?.content_block;
    return block ? [block] : [];
  }
  const content = (message.message as { content?: ToolUseBlock[] } | undefined)?.content;
  return Array.isArray(content) ? content : [];
};

/** A connector id must be known when its result arrives, even while the call still sits in the inbox. */
function noteConnectorCalls(binding: Binding, message: ClaudeSdkMessage): void {
  for (const block of toolUseBlocksOf(message)) {
    if (block.type !== "tool_use" || !block.id || !isConnectorToolName(block.name ?? "")) continue;
    if (binding.connectorIds.has(block.id)) continue;
    binding.connectorIds.add(block.id);
    binding.openConnectorIds.add(block.id);
  }
}

function onApiPart(binding: Binding, message: ClaudeSdkMessage): void {
  noteConnectorCalls(binding, message);
  if (message.type === "assistant") binding.connectorTail = false;
  const listener = activeListener(binding);
  if (listener) listener.feed(message);
  else binding.inbox.push(message);
}

function dispatch(rt: Runtime, binding: Binding, message: ClaudeSdkMessage): void {
  if (binding.onFirstMessage && typeof message.session_id === "string") {
    const commit = binding.onFirstMessage;
    binding.onFirstMessage = null;
    commit(message.session_id);
  }
  if (message.type === "system") onSystem(rt, binding, message);
  else if (message.type === "rate_limit_event") onRateLimit(rt, binding, message);
  else if (message.type === "result") onResult(rt, binding, message);
  else if (message.type === "user") {
    if (!routeConnectorResults(rt, binding, message)) binding.listener?.feed(message);
  } else if (message.type === "stream_event" || message.type === "assistant") onApiPart(binding, message);
  else binding.listener?.feed(message);
}

const errorText = (error: unknown): string =>
  neutralText(error instanceof Error ? error.message : String(error));

/** Reads a query until it ends and hands each message to the binding's current turn. */
export function pump(rt: Runtime, binding: Binding, query: ClaudeQuery): void {
  void (async () => {
    let failure: string | null = null;
    try {
      for await (const message of query) {
        if (binding.query !== query) return;
        dispatch(rt, binding, message);
      }
    } catch (error) {
      failure = errorText(error);
    }
    if (binding.query !== query) return;
    const listener = binding.listener;
    closeQuery(rt, binding);
    if (failure === null) listener?.end();
    else listener?.fail(failure);
  })();
}
