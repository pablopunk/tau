import type { ClaudeConnectorSettings } from "@tau/protocol";
import { chooseServers, disallowedToolsOf } from "../connectors/chosen-servers";
import type { ClaudeMcpServerStatus } from "../sdk-types";

/** What the query options need to know about the connectors the user switched on. */
export interface ConnectorChoice {
  /** Status names (`claude.ai Linear`). */
  readonly names: readonly string[];
  /** When true, tools that change things ask the user; when false, every tool of a chosen server is allowed. */
  readonly askBeforeWrites: boolean;
  /** Exact read-only tool names of the chosen servers, then the always-allowed tools of those servers. */
  readonly allowedTools: readonly string[];
  /** One glob for every claude.ai server that is not chosen. */
  readonly disallowedTools: readonly string[];
}

export const NO_CONNECTORS: ConnectorChoice = {
  names: [],
  askBeforeWrites: false,
  allowedTools: [],
  disallowedTools: [],
};

/** Changes when the user switches a server off or on. */
export const optionsKeyOf = (settings: ClaudeConnectorSettings | null): string =>
  [...(settings?.disabled ?? [])].sort().join("|") + (settings?.askBeforeWrites ? "|ask" : "");

function chooseFromStatus(
  settings: ClaudeConnectorSettings,
  status: readonly ClaudeMcpServerStatus[],
): ConnectorChoice {
  const { names, allowedTools } = chooseServers(settings, status);
  return {
    names,
    askBeforeWrites: settings.askBeforeWrites,
    allowedTools,
    disallowedTools: disallowedToolsOf(names, status),
  };
}

export function chooseConnectors(
  settings: ClaudeConnectorSettings | null,
  status: readonly ClaudeMcpServerStatus[] | null,
): ConnectorChoice {
  if (!settings || !status) return NO_CONNECTORS;
  return chooseFromStatus(settings, status);
}
