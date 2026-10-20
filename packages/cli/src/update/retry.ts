export const RETRY_BACKOFF_MS: readonly number[] = [2_000, 5_000];

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Network errors, timeouts and 5xx are transient; 404 and anything else are not. */
export function isTransient(error: unknown): boolean {
  if (error instanceof HttpStatusError) return error.status >= 500;
  return !(error instanceof Error && error.name === "ChecksumError");
}

export async function withRetries<T>(task: () => Promise<T>, sleep: Sleep = realSleep): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      const wait = RETRY_BACKOFF_MS[attempt];
      if (wait === undefined || !isTransient(error)) throw error;
      await sleep(wait);
    }
  }
}
