export const STARTING_TEXT = "Setting up remote access (usually 3-6 minutes).";
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

export const CREATE_DEADLINE_MS = 12 * 60 * 1000;

const STAGE_TEXT: Record<string, string> = {
  "generating-csr": "Preparing the certificate request.",
  "requesting-certificate": "Requesting the certificate.",
  "waiting-certificate": "Waiting for the certificate (usually 3-6 minutes).",
};

/** The message for a provisioning stage; stages without text keep the generic one. */
export const stageText = (stage: string): string => STAGE_TEXT[stage] ?? STARTING_TEXT;
