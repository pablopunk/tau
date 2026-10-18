import type { Api, Model, SimpleStreamOptions, Tool, TranscriptContext } from "@earendil-works/pi-ai";
import { CONNECTOR_TOOL_NAME } from "../connectors/names";
import type { ClaudeEffort } from "../sdk-types";
import { abortedToolCallIds, type Entry, normalize, prefixHashes } from "./normalize";
import { effortOf } from "./query-options";
import { readSystemState } from "./system-state";

/** Everything one Pi request says, read once. */
export interface CallContext {
  readonly model: Model<Api>;
  readonly modelValue: string;
  readonly effort: ClaudeEffort | undefined;
  readonly systemPrompt: string;
  readonly tools: readonly Tool[];
  readonly entries: readonly Entry[];
  readonly hashes: readonly string[];
  /** Tool results Pi marked aborted: they are not in `entries`. */
  readonly abortedToolCallIds: readonly string[];
  readonly sessionId: string | undefined;
  readonly signal: AbortSignal | undefined;
}

export function readCallContext(
  model: Model<Api>,
  context: TranscriptContext,
  options: SimpleStreamOptions | undefined,
): CallContext {
  const entries = normalize(context.messages);
  const system = readSystemState(context.messages);
  return {
    model,
    modelValue: model.id,
    effort: effortOf(options?.reasoning),
    systemPrompt: system.prompt,
    tools: system.tools.filter((tool) => tool.name !== CONNECTOR_TOOL_NAME),
    entries,
    hashes: prefixHashes(entries),
    abortedToolCallIds: abortedToolCallIds(context.messages),
    sessionId: options?.sessionId,
    signal: options?.signal,
  };
}

export const headOf = (call: CallContext) => ({
  length: call.entries.length,
  hash: call.hashes[call.entries.length] ?? "",
});
