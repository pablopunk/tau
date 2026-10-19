import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export type OpenSocket = (url: string, headers: Record<string, string>) => SocketLike;

/** Everything a command touches outside its own arguments, so tests can replace it. */
export interface CommandEnv {
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly fetch: typeof fetch;
  readonly openSocket: OpenSocket;
  readonly sleep: (ms: number) => Promise<void>;
  /** Runs `fn` later; the returned function cancels it. */
  readonly after: (ms: number, fn: () => void) => () => void;
  readonly now: () => number;
  /** How long to wait for a starting server to publish its URL. */
  readonly startupWaitMs: number;
  /** A slow re-check in case a `changed` frame is missed. */
  readonly pollMs: number;
  readonly skillPaths: readonly string[];
  /** Asks a yes/no question on a terminal; absent when there is none (then `--yes` is required). */
  readonly confirm?: (question: string) => Promise<boolean>;
}

const defaultOpenSocket: OpenSocket = (url, headers) => {
  const Socket = WebSocket as unknown as new (
    url: string,
    init: { headers: Record<string, string> },
  ) => SocketLike;
  return new Socket(url, { headers });
};

const askOnTerminal = async (question: string): Promise<boolean> => {
  const lines = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await lines.question(question)).trim());
  } finally {
    lines.close();
  }
};

export const homeOf = (env: Readonly<Record<string, string | undefined>>): string =>
  env.TAU_HOME ?? join(homedir(), ".tau");

export function processEnv(): CommandEnv {
  return {
    home: homeOf(process.env),
    env: process.env,
    stdout: (text) => void process.stdout.write(`${text}\n`),
    stderr: (text) => void process.stderr.write(`${text}\n`),
    fetch: (input, init) => fetch(input, init),
    openSocket: defaultOpenSocket,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    after: (ms, fn) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    },
    now: Date.now,
    startupWaitMs: 5000,
    pollMs: 2000,
    skillPaths: [],
    confirm: process.stdin.isTTY ? askOnTerminal : undefined,
  };
}
