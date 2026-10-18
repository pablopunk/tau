import type {
  ClaudeAccountInfo,
  ClaudeAuthStatus,
  ClaudeModelOption,
  ClaudeProbe,
  ClaudeProbeOptions,
  ClaudeQueryOptions,
  ClaudeSdkPort,
} from "../sdk-types";
import { createFakeMcpState, type FakeConnectorServer } from "./fake-claude-connectors";
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
  /** The servers `mcpServerStatus()` lists when connectors are not locked down. */
  readonly connectors?: readonly FakeConnectorServer[];
  /** The first N status calls report every connector as `pending`. */
  readonly pendingPolls?: number;
}

export interface FakeClaudeSdk {
  readonly port: ClaudeSdkPort;
  readonly queries: readonly QueryRecord[];
  readonly deletedSessions: readonly string[];
  /** One entry per `startProbe()` call. */
  readonly probes: readonly { readonly settingSources: readonly string[] }[];
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
  const probes: { readonly settingSources: readonly string[] }[] = [];
  const connectors = options.connectors ?? [];
  const pendingPolls = options.pendingPolls ?? 0;

  const startProbe = (probeOptions: ClaudeProbeOptions = {}): ClaudeProbe => {
    probes.push({ settingSources: probeOptions.settingSources ?? [] });
    const mcp = createFakeMcpState({ open: true, connectors, tauTools: () => [], pendingPolls, toggles: [] });
    return { ...mcp.control, contextSummary: async () => mcp.context(), close: () => undefined };
  };

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
    startProbe,
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
        permissionRequests: [],
        connectorCalls: [],
        toggles: [],
      };
      queries.push(record);
      return createFakeQuery({
        options: queryOptions,
        record,
        script: (turn, text, hasTools) => script(turn, text, hasTools),
        ids,
        apiKeySource: options.apiKeySource ?? "none",
        connectors,
        pendingPolls,
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
    probes,
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
