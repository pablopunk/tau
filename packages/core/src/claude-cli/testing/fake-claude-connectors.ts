import { cliToolNameOf, connectorServerOf } from "../connectors/names";
import type {
  ClaudeContextSummary,
  ClaudeMcpControl,
  ClaudeMcpServerStatus,
  ClaudeMcpState,
  ClaudeMcpTool,
  ClaudeQueryOptions,
} from "../sdk-types";

export interface FakeConnectorServer {
  /** The name `mcpServerStatus()` reports, for example `claude.ai Linear`. */
  readonly name: string;
  readonly status: ClaudeMcpState;
  readonly source?: string;
  readonly tools: readonly ClaudeMcpTool[];
}

export const FAKE_LINEAR: FakeConnectorServer = {
  name: "claude.ai Linear",
  status: "connected",
  tools: [
    { name: "list_teams", readOnly: true },
    { name: "get_issue", readOnly: true },
    { name: "save_comment", readOnly: false },
  ],
};

export const FAKE_SLACK: FakeConnectorServer = {
  name: "claude.ai Slack",
  status: "connected",
  tools: [
    { name: "slack_search_public", readOnly: true },
    { name: "slack_send_message", readOnly: false },
  ],
};

export const FAKE_NEEDS_AUTH: FakeConnectorServer = {
  name: "claude.ai Notion",
  status: "needs-auth",
  tools: [],
};

/** A connector call the fake CLI runs itself: the SDK never routes it through the `tau` tool host. */
export interface FakeConnectorRun {
  /** The status name of the server. */
  readonly server: string;
  readonly result: string;
  readonly isError?: boolean;
  /** 0 or absent: the result follows the message at once (early). More: it arrives later (late). */
  readonly delayMs?: number;
}

export const connectorCliName = (server: string, tool: string): string =>
  cliToolNameOf({ server: connectorServerOf(server), tool });

export const connectorsAreOpen = (options: ClaudeQueryOptions): boolean =>
  !options.strictMcpConfig && !options.settings.disableClaudeAiConnectors;

const matchesAllowed = (allowed: string, toolName: string): boolean =>
  allowed.endsWith("*") ? toolName.startsWith(allowed.slice(0, -1)) : allowed === toolName;

export const isAllowedByList = (allowedTools: readonly string[], toolName: string): boolean =>
  allowedTools.some((allowed) => matchesAllowed(allowed, toolName));

export interface FakeMcpState {
  readonly control: ClaudeMcpControl;
  readonly context: () => ClaudeContextSummary;
  readonly activeToolNames: () => string[];
  readonly toggles: { name: string; enabled: boolean }[];
}

export interface FakeMcpInput {
  readonly open: boolean;
  readonly connectors: readonly FakeConnectorServer[];
  readonly tauTools: () => readonly string[];
  /** The first N status calls report `pending` for every connector. */
  readonly pendingPolls: number;
  readonly toggles: { name: string; enabled: boolean }[];
}

const disabledServer = (server: ClaudeMcpServerStatus): ClaudeMcpServerStatus => ({
  ...server,
  status: "disabled",
  tools: [],
});

export function createFakeMcpState(input: FakeMcpInput): FakeMcpState {
  const switchedOff = new Set<string>();
  const { toggles } = input;
  let polls = 0;
  const stillPending = () => polls >= 1 && polls <= input.pendingPolls;
  const tauServer = (): ClaudeMcpServerStatus => ({
    name: "tau",
    status: "connected",
    source: "sdk",
    error: null,
    tools: input.tauTools().map((name) => ({ name, readOnly: false })),
  });
  const connectorServer = (server: FakeConnectorServer): ClaudeMcpServerStatus => {
    const status: ClaudeMcpServerStatus = {
      name: server.name,
      status: stillPending() ? "pending" : server.status,
      source: server.source ?? "claudeai",
      error: null,
      tools: stillPending() ? [] : server.tools,
    };
    return switchedOff.has(server.name) ? disabledServer(status) : status;
  };
  const statuses = (): ClaudeMcpServerStatus[] => [
    tauServer(),
    ...(input.open ? input.connectors.map(connectorServer) : []),
  ];
  const loadedConnectorTools = () =>
    statuses()
      .filter((server) => server.source !== "sdk" && server.status === "connected")
      .flatMap((server) => server.tools.map((tool) => ({ server: server.name, tool: tool.name })));
  return {
    toggles,
    control: {
      async mcpServerStatus() {
        polls += 1;
        return statuses();
      },
      async toggleMcpServer(name, enabled) {
        toggles.push({ name, enabled });
        if (enabled) switchedOff.delete(name);
        else switchedOff.add(name);
      },
    },
    context: () => {
      const loadedMcpToolCounts: Record<string, number> = {};
      for (const { server } of loadedConnectorTools())
        loadedMcpToolCounts[server] = (loadedMcpToolCounts[server] ?? 0) + 1;
      return { memoryFileCount: 0, loadedMcpToolCounts };
    },
    activeToolNames: () => loadedConnectorTools().map(({ server, tool }) => connectorCliName(server, tool)),
  };
}
