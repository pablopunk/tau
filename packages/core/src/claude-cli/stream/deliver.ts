import type { Binding } from "./binding";
import { type CallContext, headOf } from "./call-context";
import { withoutConnectorResults } from "./connector-filter";
import { contentOfEntries, toMcpResult } from "./content";
import { interruptAndSettle, pushInput } from "./lifecycle";
import type { Entry } from "./normalize";
import type { Runtime } from "./runtime";

const answeredIds = (suffix: readonly Entry[]): Set<string> =>
  new Set(suffix.flatMap(({ message }) => (message.role === "toolResult" ? [message.toolCallId] : [])));

const hasUnansweredCalls = (binding: Binding, suffix: readonly Entry[]): boolean => {
  const answered = answeredIds(suffix);
  return [...binding.expected].some((id) => !answered.has(id));
};

/** Resolves the deferreds in transcript order, then returns what must go in as user text. */
function resolveDeferreds(binding: Binding, suffix: readonly Entry[], viaMcp: boolean): Entry[] {
  const asText: Entry[] = [];
  for (const entry of suffix) {
    const { message } = entry;
    if (message.role === "toolResult" && viaMcp && binding.expected.has(message.toolCallId)) {
      binding.calls.resolve(message.toolCallId, toMcpResult(message));
      binding.expected.delete(message.toolCallId);
    } else asText.push(entry);
  }
  return asText;
}

const hasAbortedOpenConnector = (binding: Binding, call: CallContext): boolean =>
  call.abortedToolCallIds.some((id) => binding.openConnectorIds.has(id));

/**
 * Continue: the query is live. Results go to the parked handlers, steers follow as one user message.
 * A call Pi left unanswered (aborted) means the CLI turn is still parked: interrupt it first.
 */
export async function continueLive(
  rt: Runtime,
  binding: Binding,
  call: CallContext,
  allResults: readonly Entry[],
): Promise<void> {
  const suffix = withoutConnectorResults(binding, allResults);
  const query = binding.query;
  if (!query || !binding.input) throw new Error("The Claude CLI session is not running.");
  if (binding.model !== call.modelValue) {
    await query.setModel(call.modelValue);
    binding.model = call.modelValue;
  }
  const viaMcp = !hasUnansweredCalls(binding, suffix);
  if (!viaMcp || hasAbortedOpenConnector(binding, call)) await interruptAndSettle(rt, binding);
  const asText = resolveDeferreds(binding, suffix, viaMcp);
  if (asText.length > 0) pushInput(binding, contentOfEntries(asText));
  binding.head = headOf(call);
  rt.persistBinding(binding);
}
