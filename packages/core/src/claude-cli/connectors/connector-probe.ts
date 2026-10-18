import type { ClaudeConnector } from "@tau/protocol";
import type { ClaudeSdkLoader } from "../sdk-types";

export interface ConnectorProbeDeps {
  readonly sdk: ClaudeSdkLoader;
  readonly onChange: () => void;
}

/** One short-lived probe query (`ClaudeSdkPort.startProbe`), cached. Owner A implements it. */
export interface ConnectorProbe {
  /** The cached list; `null` until a probe ran or when it failed. */
  current(): ClaudeConnector[] | null;
  /** Probes again; resolves with the new list. Never rejects. */
  refresh(): Promise<ClaudeConnector[] | null>;
}

export function createConnectorProbe(_deps: ConnectorProbeDeps): ConnectorProbe {
  return { current: () => null, refresh: async () => null };
}
