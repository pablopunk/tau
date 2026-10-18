export const STARTING_TEXT = "Starting. The first time takes a few minutes.";
export const OFFLINE_TEXT = "Cannot reach the tunnel service";
export const RECREATE_TEXT = "The tunnel has been offline for 10 minutes. You can make a new URL.";
const GENERIC = "The tunnel service had a problem.";

/** Relay error text never reaches the user: every failure maps to one of these sentences. */
export function neutralRemoteText(offline = false): string {
  return offline ? OFFLINE_TEXT : GENERIC;
}

const NETWORK_CODES =
  /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|fetch failed|network|offline/i;

export function isNetworkFailure(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message} ${String((error.cause as Error | undefined)?.message ?? "")}`
      : String(error);
  return NETWORK_CODES.test(text);
}

export const neutralFailure = (error: unknown): string => neutralRemoteText(isNetworkFailure(error));
