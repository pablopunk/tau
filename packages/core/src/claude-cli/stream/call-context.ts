import type { Api, Model, SimpleStreamOptions, Tool, TranscriptContext } from "@earendil-works/pi-ai";
import type { ClaudeEffort } from "../sdk-types";
import { type Entry, normalize, prefixHashes } from "./normalize";
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
    tools: system.tools,
    entries,
    hashes: prefixHashes(entries),
    sessionId: options?.sessionId,
    signal: options?.signal,
  };
}

export const headOf = (call: CallContext) => ({
  length: call.entries.length,
  hash: call.hashes[call.entries.length] ?? "",
});
