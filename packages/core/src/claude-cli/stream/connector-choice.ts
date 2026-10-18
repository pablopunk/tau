import type { ClaudeConnectorSettings } from "@tau/protocol";
import { chooseServers, disallowedToolsOf } from "../connectors/chosen-servers";
import { connectorServerOf, parseConnectorToolName } from "../connectors/names";
import type { ClaudeMcpServerStatus } from "../sdk-types";

/** What the query options need to know about the connectors the user switched on. */
export interface ConnectorChoice {
  /** Status names (`claude.ai Linear`). */
  readonly names: readonly string[];
  /** Exact read-only tool names of the chosen servers, then the always-allowed tools of those servers. */
  readonly allowedTools: readonly string[];
  /** One glob for every claude.ai server that is not chosen. */
  readonly disallowedTools: readonly string[];
}

export const NO_CONNECTORS: ConnectorChoice = { names: [], allowedTools: [], disallowedTools: [] };

/** Changes when the user switches a server on or off. */
export const optionsKeyOf = (settings: ClaudeConnectorSettings | null): string =>
  [...(settings?.enabled ?? [])].sort().join("|");

function chooseFromStatus(
  settings: ClaudeConnectorSettings,
  status: readonly ClaudeMcpServerStatus[],
): ConnectorChoice {
  const { names, allowedTools } = chooseServers(settings, status);
  return { names, allowedTools, disallowedTools: disallowedToolsOf(names, status) };
}

const belongsTo = (cliToolName: string, servers: readonly string[]): boolean => {
  const parsed = parseConnectorToolName(cliToolName);
  return parsed !== null && servers.some((name) => connectorServerOf(name) === parsed.server);
};

/** Without a status list, every enabled server counts as chosen and only the always-allowed tools skip the ask. */
const chooseWithoutStatus = (settings: ClaudeConnectorSettings): ConnectorChoice => ({
  names: [...settings.enabled],
  allowedTools: settings.alwaysAllow.filter((tool) => belongsTo(tool, settings.enabled)),
  disallowedTools: [],
});

export function chooseConnectors(
  settings: ClaudeConnectorSettings | null,
  status: readonly ClaudeMcpServerStatus[] | null,
): ConnectorChoice {
  if (!settings || settings.enabled.length === 0) return NO_CONNECTORS;
  return status ? chooseFromStatus(settings, status) : chooseWithoutStatus(settings);
}
