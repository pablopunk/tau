import type { ClaudeToolResult } from "../sdk-types";

interface Entry {
  readonly promise: Promise<ClaudeToolResult>;
  readonly resolve: (result: ClaudeToolResult) => void;
  readonly reject: (reason: Error) => void;
  waiting: boolean;
  settled: boolean;
}

export interface CallMap {
  /** The MCP handler side: takes (or creates) the deferred and awaits it. */
  wait(toolUseId: string): Promise<ClaudeToolResult>;
  /** The Pi side: resolves (or creates, already resolved) the deferred. */
  resolve(toolUseId: string, result: ClaudeToolResult): void;
  rejectAll(reason: Error): void;
  hasParkedHandler(): boolean;
}

function createEntry(): Entry {
  let resolve: Entry["resolve"] = () => undefined;
  let reject: Entry["reject"] = () => undefined;
  const promise = new Promise<ClaudeToolResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => undefined);
  return { promise, resolve, reject, waiting: false, settled: false };
}

export function createCallMap(): CallMap {
  const entries = new Map<string, Entry>();
  const entryOf = (id: string): Entry => {
    const existing = entries.get(id);
    if (existing) return existing;
    const created = createEntry();
    entries.set(id, created);
    return created;
  };
  return {
    wait(id) {
      const entry = entryOf(id);
      entry.waiting = true;
      return entry.promise.finally(() => entries.delete(id));
    },
    resolve(id, result) {
      const entry = entryOf(id);
      if (entry.settled) return;
      entry.settled = true;
      entry.resolve(result);
    },
    rejectAll(reason) {
      for (const entry of entries.values()) {
        if (entry.settled) continue;
        entry.settled = true;
        entry.reject(reason);
      }
      entries.clear();
    },
    hasParkedHandler: () => [...entries.values()].some((entry) => entry.waiting && !entry.settled),
  };
}
