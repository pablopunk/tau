import type {
  ClaudeAccountInfo,
  ClaudeAuthStatus,
  ClaudeModelOption,
  ClaudeQueryOptions,
  ClaudeSdkPort,
} from "../sdk-types";
import { createMessageIds } from "./fake-claude-events";
import { FAKE_CLAUDE_MODELS } from "./fake-claude-models";
import { createFakeQuery, type QueryRecord } from "./fake-claude-query";
import { type FakeScript, sayOk } from "./fake-claude-script";

export const FAKE_LOGGED_IN: ClaudeAuthStatus = {
  loggedIn: true,
  authMethod: "claude.ai",
  subscriptionType: "team",
  orgName: "Fake Org",
};

export interface FakeClaudeSdkOptions {
  readonly script?: FakeScript;
  readonly auth?: ClaudeAuthStatus;
  readonly models?: readonly ClaudeModelOption[];
  readonly account?: ClaudeAccountInfo;
  readonly bundledCliVersion?: string;
  /** What `init.apiKeySource` reports. Anything but `"none"` must stop the run. */
  readonly apiKeySource?: string;
}

export interface FakeClaudeSdk {
  readonly port: ClaudeSdkPort;
  readonly queries: readonly QueryRecord[];
  readonly deletedSessions: readonly string[];
  readonly loadCount: () => number;
  /** A loader for code that takes `ClaudeSdkLoader`; counts how often the SDK was "imported". */
  readonly load: () => Promise<ClaudeSdkPort>;
  setScript(script: FakeScript): void;
  setAuth(auth: ClaudeAuthStatus | Error): void;
}

export function createFakeClaudeSdk(options: FakeClaudeSdkOptions = {}): FakeClaudeSdk {
  const queries: QueryRecord[] = [];
  const deletedSessions: string[] = [];
  const ids = createMessageIds();
  let script = options.script ?? sayOk;
  let auth: ClaudeAuthStatus | Error = options.auth ?? FAKE_LOGGED_IN;
  let sessions = 0;
  let loads = 0;

  const sessionFor = (query: ClaudeQueryOptions): string =>
    query.resume && !query.forkSession ? query.resume : `fake-session-${++sessions}`;

  const port: ClaudeSdkPort = {
    async authStatus() {
      if (auth instanceof Error) throw auth;
      return auth;
    },
    async accountInfo() {
      return options.account ?? { organization: "Fake Org", subscriptionType: "Claude Team" };
    },
    async supportedModels() {
      return options.models ?? FAKE_CLAUDE_MODELS;
    },
    async bundledCliVersion() {
      return options.bundledCliVersion ?? "0.0.0-fake";
    },
    startQuery(queryOptions) {
      const record: QueryRecord = {
        options: queryOptions,
        sessionId: sessionFor(queryOptions),
        inputs: [],
        folded: [],
        toolCalls: [],
        toolResults: [],
        models: [],
        flags: [],
        interrupts: 0,
        closed: false,
      };
      queries.push(record);
      return createFakeQuery({
        options: queryOptions,
        record,
        script: (turn, text) => script(turn, text),
        ids,
        apiKeySource: options.apiKeySource ?? "none",
      });
    },
    async deleteSession(sessionId) {
      deletedSessions.push(sessionId);
    },
  };

  return {
    port,
    queries,
    deletedSessions,
    loadCount: () => loads,
    async load() {
      loads += 1;
      return port;
    },
    setScript(next) {
      script = next;
    },
    setAuth(next) {
      auth = next;
    },
  };
}
