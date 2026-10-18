import type { ClaudeConnectorSettings } from "@tau/protocol";
import {
  cliToolNameOf,
  connectorAllowGlobOf,
  connectorServerOf,
  isClaudeAiServer,
  parseConnectorToolName,
} from "../connectors/names";
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

const isConnected = (server: ClaudeMcpServerStatus) => server.status === "connected";

const chosenStatuses = (
  settings: ClaudeConnectorSettings,
  status: readonly ClaudeMcpServerStatus[],
): ClaudeMcpServerStatus[] =>
  status.filter((server) => isConnected(server) && settings.enabled.includes(server.name));

const readOnlyNamesOf = (server: ClaudeMcpServerStatus): string[] =>
  server.tools
    .filter((tool) => tool.readOnly)
    .map((tool) => cliToolNameOf({ server: connectorServerOf(server.name), tool: tool.name }));

const belongsTo = (cliToolName: string, servers: readonly string[]): boolean => {
  const parsed = parseConnectorToolName(cliToolName);
  return parsed !== null && servers.some((name) => connectorServerOf(name) === parsed.server);
};

function chooseFromStatus(
  settings: ClaudeConnectorSettings,
  status: readonly ClaudeMcpServerStatus[],
): ConnectorChoice {
  const chosen = chosenStatuses(settings, status);
  const names = chosen.map((server) => server.name);
  const allowedTools = [
    ...chosen.flatMap(readOnlyNamesOf),
    ...settings.alwaysAllow.filter((tool) => belongsTo(tool, names)),
  ];
  const disallowedTools = status
    .filter((server) => isClaudeAiServer(server.name) && !names.includes(server.name))
    .map((server) => connectorAllowGlobOf(server.name));
  return { names, allowedTools: [...new Set(allowedTools)], disallowedTools };
}

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
