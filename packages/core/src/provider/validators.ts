import { AppError } from "@pi-everywhere/protocol";
import { checkOpenRouterKey } from "./openrouter-key";

export type KeyCheck = "valid" | "invalid" | "unknown";
export type KeyValidator = (key: string, fetchFn?: typeof fetch) => Promise<KeyCheck>;

const REQUEST_TIMEOUT_MS = 10_000;

interface ModelsRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly rejects: (response: Response) => boolean | Promise<boolean>;
}

async function checkModelsRequest(request: ModelsRequest, fetchFn: typeof fetch): Promise<KeyCheck> {
  let response: Response;
  try {
    response = await fetchFn(request.url, {
      headers: request.headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return "unknown";
  }
  if (await request.rejects(response)) return "invalid";
  return response.ok ? "valid" : "unknown";
}

const isUnauthorized = (response: Response) => response.status === 401;

async function isGoogleKeyRejection(response: Response): Promise<boolean> {
  if (response.status === 401 || response.status === 403) return true;
  if (response.status !== 400) return false;
  return (await response.text().catch(() => "")).includes("INVALID_ARGUMENT");
}

export const validateOpenAiKey: KeyValidator = (key, fetchFn = fetch) =>
  checkModelsRequest(
    {
      url: "https://api.openai.com/v1/models",
      headers: { authorization: `Bearer ${key}` },
      rejects: isUnauthorized,
    },
    fetchFn,
  );

export const validateAnthropicKey: KeyValidator = (key, fetchFn = fetch) =>
  checkModelsRequest(
    {
      url: "https://api.anthropic.com/v1/models",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      rejects: isUnauthorized,
    },
    fetchFn,
  );

export const validateGoogleKey: KeyValidator = (key, fetchFn = fetch) =>
  checkModelsRequest(
    {
      url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      headers: {},
      rejects: isGoogleKeyRejection,
    },
    fetchFn,
  );

export const validateOpenCodeKey: KeyValidator = (key, fetchFn = fetch) =>
  checkModelsRequest(
    {
      url: "https://opencode.ai/zen/v1/models",
      headers: { authorization: `Bearer ${key}` },
      rejects: isUnauthorized,
    },
    fetchFn,
  );

export const validateOpenRouterKey: KeyValidator = async (key) => {
  try {
    return await checkOpenRouterKey(key);
  } catch (error) {
    if (error instanceof AppError) return "unknown";
    throw error;
  }
};
