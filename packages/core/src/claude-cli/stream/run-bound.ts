import type { AssistantMessage, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { Binding } from "./binding";
import type { CallContext } from "./call-context";
import type { Plan } from "./choose-path";
import { isAuthCode, neutralText } from "./errors";
import { finalEvent } from "./finish";
import { cancelIdle, interruptAndSettle, touchIdle } from "./lifecycle";
import { assistantKey, chainHash } from "./normalize";
import { prepare } from "./prepare";
import type { Runtime } from "./runtime";
import { createTurn, type TurnOutcome } from "./turn";

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function recordCheckpoint(
  binding: Binding,
  call: CallContext,
  message: AssistantMessage,
  uuid: string | null,
) {
  const length = call.entries.length + 1;
  const hash = chainHash(call.hashes[call.entries.length] ?? "", assistantKey(message));
  binding.checkpoints.push({ length, hash, sdkUuid: uuid });
  binding.head = { length, hash };
}

/** What the SDK session and the binding look like after the turn. */
function settleAfter(
  rt: Runtime,
  binding: Binding,
  call: CallContext,
  message: AssistantMessage,
  outcome: TurnOutcome,
): void {
  if (outcome.kind === "failed" && outcome.failure === "limit") {
    binding.settling = interruptAndSettle(rt, binding);
  }
  if (outcome.kind !== "complete") return;
  const { summary } = outcome;
  const isToolRound = summary.stopReason === "toolUse";
  if (summary.errorCode === null) recordCheckpoint(binding, call, message, summary.lastUuid);
  else if (isAuthCode(summary.errorCode)) rt.deps.onAuthError();
  if (isToolRound) for (const id of summary.toolUseIds) binding.expected.add(id);
  else binding.owedResults += 1;
  if (summary.errorCode !== null && binding.expected.size > 0) {
    binding.settling = interruptAndSettle(rt, binding);
  }
}

/** One Pi request on a bound SDK session: Continue, Resume, Resume-at or Rebind. */
export async function runBound(
  rt: Runtime,
  binding: Binding,
  plan: Exclude<Plan, { kind: "oneShot" }>,
  call: CallContext,
  message: AssistantMessage,
  stream: AssistantMessageEventStream,
): Promise<void> {
  cancelIdle(binding);
  const turn = createTurn(message, (event) => stream.push(event));
  binding.listener = turn;
  const onAbort = () => {
    turn.abort();
    binding.settling = interruptAndSettle(rt, binding);
  };
  call.signal?.addEventListener("abort", onAbort, { once: true });
  if (call.signal?.aborted) onAbort();
  try {
    await prepare(rt, binding, plan, call);
  } catch (error) {
    turn.fail(neutralText(messageOf(error)));
  }
  const outcome = await turn.outcome;
  call.signal?.removeEventListener("abort", onAbort);
  binding.listener = null;
  settleAfter(rt, binding, call, message, outcome);
  stream.push(finalEvent(message, outcome, binding.latestResetsAt));
  touchIdle(rt, binding);
}
