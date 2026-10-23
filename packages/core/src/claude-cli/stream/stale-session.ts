import type { ClaudeSdkMessage } from "../sdk-types";
import type { Binding } from "./binding";
import type { Plan } from "./choose-path";
import { closeQuery } from "./lifecycle";
import type { Runtime } from "./runtime";
import type { TurnOutcome } from "./turn";

const STALE_SESSION_PATTERN = /no conversation found|session.*not found|unknown session|resume.*fail/i;

/** A persisted session can be gone (user wiped `~/.claude`, SDK pruned it). */
export const isStaleSessionError = (error: unknown): boolean =>
  STALE_SESSION_PATTERN.test(
    error instanceof Error ? `${error.message} ${error.cause ?? ""}` : String(error),
  );

const textOfResult = (message: ClaudeSdkMessage): string => {
  const errors = Array.isArray(message.errors) ? message.errors.join(" ") : "";
  return `${errors} ${typeof message.result === "string" ? message.result : ""}`;
};

export const isStaleSessionResult = (message: ClaudeSdkMessage): boolean =>
  message.is_error === true && STALE_SESSION_PATTERN.test(textOfResult(message));

/** Only a launch that resumes an SDK session can find it gone. */
export const resumedSessionOf = (plan: Plan, binding: Binding): string | null =>
  plan.kind === "resume" || plan.kind === "resumeAt" ? binding.sdkSessionId : null;

const isStaleOutcome = (outcome: TurnOutcome): boolean =>
  outcome.kind === "failed" && outcome.failure === "stale";

function forgetSessionIdentity(binding: Binding, resumed: string): void {
  for (const id of new Set([resumed, binding.sdkSessionId])) {
    if (id !== null) binding.created.delete(id);
  }
  binding.sdkSessionId = null;
  binding.checkpoints = [];
  binding.head = null;
}

/**
 * The one place a stale session is handled, however it surfaced: an awaited launch rejection, a failing
 * iterator or an error `result`. It stops the old query, forgets this binding's session identity and
 * its persisted row, and answers whether the caller may rebind once. It refuses once any API message
 * reached the turn, because a tool may already have run and a rebind would run it again.
 */
export function invalidateStaleSession(
  rt: Runtime,
  binding: Binding,
  resumed: string | null,
  outcome: TurnOutcome,
): boolean {
  if (resumed === null || !isStaleOutcome(outcome) || binding.apiPartSeen) return false;
  closeQuery(rt, binding);
  forgetSessionIdentity(binding, resumed);
  rt.dropBinding(binding.id);
  return true;
}
