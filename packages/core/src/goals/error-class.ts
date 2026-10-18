/** What a goal does with an error, as in Claude Code: stop for good, pause until the user resumes, or retry. */
export type ErrorClass = "clear" | "pause" | "retry";

const RATE_LIMITS = /rate.?limit|usage limit|too many requests|\b429\b/i;
const CLEARING =
  /unauthori[sz]ed|\b40[13]\b|authentication|invalid.{0,12}(api.?)?key|credit|insufficient|billing|payment|no such model|model.{0,20}(not found|does not exist|not available)|\b404\b|context (length|window)|prompt is too long|too many tokens|maximum context/i;

export function classifyError(message: string): ErrorClass {
  if (RATE_LIMITS.test(message)) return "pause";
  if (CLEARING.test(message)) return "clear";
  return "retry";
}

export const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 5000;

export const backoffMs = (attempt: number) => BACKOFF_BASE_MS * 2 ** attempt;

export const errorNotice = (kind: "run" | "judge", cls: ErrorClass, message: string): string => {
  const what = kind === "run" ? "The run failed" : "The goal check failed";
  if (cls === "clear") return `Goal cleared. ${what}: ${message}`;
  return `Goal paused. ${what}: ${message}`;
};
