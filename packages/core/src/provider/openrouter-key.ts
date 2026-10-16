import { AppError } from "@pi-everywhere/protocol";

export const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";
const REQUEST_TIMEOUT_MS = 15_000;

export type KeyCheck = "valid" | "invalid";

async function requestKeyInfo(key: string): Promise<Response> {
  try {
    return await fetch(OPENROUTER_KEY_URL, {
      headers: { accept: "application/json", authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError("internal", "Could not reach OpenRouter to check the key. Check your connection.");
  }
}

/** Asks OpenRouter whether the key works. Rejects `internal` when OpenRouter cannot be reached or misbehaves. */
export async function checkOpenRouterKey(key: string): Promise<KeyCheck> {
  const response = await requestKeyInfo(key);
  if (response.ok) return "valid";
  if (response.status === 401 || response.status === 403) return "invalid";
  throw new AppError("internal", `OpenRouter could not check the key (HTTP ${response.status}).`);
}

export async function assertOpenRouterKeyIsValid(key: string): Promise<void> {
  if ((await checkOpenRouterKey(key)) === "invalid") {
    throw new AppError("invalid_key", "OpenRouter rejected this API key.");
  }
}
