import { randomUUID } from "node:crypto";
import type { LoginSession } from "@tau/protocol";

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

export interface LoginRecord {
  session: LoginSession;
  attempts: number;
  readonly controller: AbortController;
  readonly pastedUrl: Deferred<string>;
  readonly firstEvent: Deferred<void>;
  settled: Promise<void>;
  timers: ReturnType<typeof setTimeout>[];
}

export function newLoginRecord(): LoginRecord {
  return {
    session: {
      id: randomUUID(),
      provider: "openai",
      method: "chatgpt",
      state: "starting",
      authUrl: null,
      error: null,
    },
    attempts: 0,
    controller: new AbortController(),
    pastedUrl: deferred<string>(),
    firstEvent: deferred<void>(),
    settled: Promise.resolve(),
    timers: [],
  };
}

export const isTerminal = (record: LoginRecord): boolean =>
  ["done", "failed", "cancelled"].includes(record.session.state);
