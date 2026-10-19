import { AppError, type ErrorCode } from "@tau/protocol";

/** What a refusing hop writes into the `close` reason, so the origin can raise the matching `AppError`. */
export const REFUSAL_REASONS = {
  clock_skew: "clock_skew",
  node_removed: "node_removed",
  no_route: "no_route",
} as const;

const MESSAGES: Record<string, { code: ErrorCode; message: string }> = {
  clock_skew: { code: "clock_skew", message: "The clocks of the two nodes differ by more than two minutes." },
  node_removed: { code: "node_removed", message: "This node was removed from the group." },
  no_route: { code: "no_route", message: "There is no route to that node." },
};

export const POLICY = 1008;
export const NO_CREDIT = 1013;

/** The `AppError` for a refusal reason that crossed a link, or `undefined` for any other close. */
export function routedRefusal(reason: string): AppError | undefined {
  const known = MESSAGES[reason];
  return known ? new AppError(known.code, known.message) : undefined;
}
