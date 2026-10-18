export const API_KEY_STOPPED_TEXT =
  "Stopped: the Claude CLI would use an API key instead of your plan login. Remove the key and try again.";
export const PROCESS_ENDED_TEXT = "The Claude CLI process ended before it answered.";
export const THREAD_CLOSED_TEXT = "The Claude CLI session was closed.";
export const GENERIC_RESULT_TEXT = "The Claude CLI run ended with an error.";

const PLAN_LIMIT_CODES = new Set(["rate_limit", "rejected"]);
const AUTH_CODES = new Set([
  "oauth_org_not_allowed",
  "authentication_failed",
  "account_on_hold",
  "billing_error",
]);

const AUTH_TEXTS: Record<string, string> = {
  oauth_org_not_allowed: "Your organization does not allow this Claude CLI login.",
  authentication_failed: "The Claude CLI login failed. Log in again with the claude CLI.",
  account_on_hold: "Your Claude account is on hold.",
  billing_error: "Claude reports a billing problem with your plan.",
};

const RETRYABLE_TEXTS: Record<string, string> = {
  overloaded: "The Claude API is overloaded. Try again soon.",
  server_error: "The Claude API had a server error. Try again soon.",
};

export const isPlanLimitCode = (code: string): boolean => PLAN_LIMIT_CODES.has(code);
export const isAuthCode = (code: string): boolean => AUTH_CODES.has(code);

const secondsOrMillis = (resetsAt: number): number => (resetsAt < 1e12 ? resetsAt * 1000 : resetsAt);

export function formatResetTime(resetsAt: number): string {
  const date = new Date(secondsOrMillis(resetsAt));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const planLimitText = (resetsAt: number | null): string =>
  resetsAt === null ? "Plan limit reached" : `Plan limit reached; resets ${formatResetTime(resetsAt)}`;

export function textForErrorCode(code: string, resetsAt: number | null): string {
  if (isPlanLimitCode(code)) return planLimitText(resetsAt);
  return AUTH_TEXTS[code] ?? RETRYABLE_TEXTS[code] ?? `The Claude CLI reported an error (${code}).`;
}

/** The UI says "Claude CLI", never "Claude Code", also for texts the CLI wrote. */
export const neutralText = (text: string): string => text.replace(/Claude Code/gi, "Claude CLI");
