import type { ClaudeConnector } from "@tau/protocol";
import type { ClaudeMcpServerStatus, ClaudeProbe, ClaudeSdkLoader } from "../sdk-types";

export interface ConnectorProbeDeps {
  readonly sdk: ClaudeSdkLoader;
  readonly onChange: () => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

/** One short-lived probe query (`ClaudeSdkPort.startProbe`), cached. */
export interface ConnectorProbe {
  /** The cached list; `null` until a probe ran or when it failed. */
  current(): ClaudeConnector[] | null;
  /** Probes again; resolves with the new list. Never rejects. */
  refresh(): Promise<ClaudeConnector[] | null>;
}

const POLL_INTERVAL_MS = 250;
const SETTLE_CAP_MS = 10_000;

const isConnectorServer = (server: ClaudeMcpServerStatus): boolean => server.source !== "sdk";

const hasSettled = (servers: readonly ClaudeMcpServerStatus[]): boolean => {
  const connectors = servers.filter(isConnectorServer);
  return connectors.length > 0 && connectors.every((server) => server.status !== "pending");
};

const statusOf = (state: ClaudeMcpServerStatus["status"]): ClaudeConnector["status"] =>
  state === "needs-auth" ? "needs_auth" : state;

const connectorOf = (server: ClaudeMcpServerStatus): ClaudeConnector => ({
  name: server.name,
  source: server.source === "claudeai" ? "claudeai" : "user",
  status: statusOf(server.status),
  toolCount: server.tools.length,
  readOnlyCount: server.tools.filter((tool) => tool.readOnly).length,
});

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createConnectorProbe(deps: ConnectorProbeDeps): ConnectorProbe {
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  let cached: ClaudeConnector[] | null = null;
  let inFlight: Promise<ClaudeConnector[] | null> | undefined;

  async function settledServers(probe: ClaudeProbe): Promise<readonly ClaudeMcpServerStatus[]> {
    const deadline = now() + SETTLE_CAP_MS;
    let servers = await probe.mcpServerStatus();
    while (!hasSettled(servers) && now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      servers = await probe.mcpServerStatus();
    }
    return servers;
  }

  async function probeOnce(): Promise<ClaudeConnector[] | null> {
    try {
      const port = await deps.sdk();
      const probe = port.startProbe();
      try {
        return (await settledServers(probe)).filter(isConnectorServer).map(connectorOf);
      } finally {
        probe.close();
      }
    } catch {
      return null;
    }
  }

  async function refresh(): Promise<ClaudeConnector[] | null> {
    cached = await probeOnce();
    deps.onChange();
    return cached;
  }

  return {
    current: () => cached,
    refresh: () => (inFlight ??= refresh().finally(() => (inFlight = undefined))),
  };
}
