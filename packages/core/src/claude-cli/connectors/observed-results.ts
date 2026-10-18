import type { ClaudeToolResult } from "../sdk-types";

/** Results of connector calls the CLI ran itself, keyed by tool use id. */
export interface ObservedResultStore {
  /** Resolves the waiter, or stores the result when nobody waits yet. Never reaches the CLI. */
  settle(toolUseId: string, result: ClaudeToolResult): void;
  /** Resolves with the result unchanged; rejects `aborted` when the signal fires. */
  wait(toolUseId: string, signal: AbortSignal): Promise<ClaudeToolResult>;
  /** The call is over: drops the entry. */
  forget(toolUseId: string): void;
  isConnectorCall(toolUseId: string): boolean;
}

interface Deferred {
  readonly promise: Promise<ClaudeToolResult>;
  readonly resolve: (result: ClaudeToolResult) => void;
}

function newDeferred(): Deferred {
  let resolve!: (result: ClaudeToolResult) => void;
  const promise = new Promise<ClaudeToolResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const abortedError = (): Error => new Error("aborted");

function rejectOnAbort(signal: AbortSignal): { promise: Promise<never>; stop: () => void } {
  let stop: () => void = () => undefined;
  const promise = new Promise<never>((_, reject) => {
    if (signal.aborted) return reject(abortedError());
    const onAbort = () => reject(abortedError());
    signal.addEventListener("abort", onAbort, { once: true });
    stop = () => signal.removeEventListener("abort", onAbort);
  });
  return { promise, stop };
}

export function createObservedResultStore(): ObservedResultStore {
  const entries = new Map<string, Deferred>();
  const entryOf = (toolUseId: string): Deferred => {
    const existing = entries.get(toolUseId);
    if (existing) return existing;
    const created = newDeferred();
    entries.set(toolUseId, created);
    return created;
  };
  return {
    settle: (toolUseId, result) => entryOf(toolUseId).resolve(result),
    async wait(toolUseId, signal) {
      const abort = rejectOnAbort(signal);
      try {
        return await Promise.race([entryOf(toolUseId).promise, abort.promise]);
      } finally {
        abort.stop();
      }
    },
    forget: (toolUseId) => void entries.delete(toolUseId),
    isConnectorCall: (toolUseId) => entries.has(toolUseId),
  };
}
