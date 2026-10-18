import type { ClaudeConnectorSettings } from "@tau/protocol";
import type { ClaudeMcpServerStatus } from "../sdk-types";
import { connectorAllowGlobOf, connectorToolPrefixOf, isClaudeAiServer } from "./names";

export interface ChosenServers {
  /** Status names (`claude.ai Linear`) the user switched on and that are connected. */
  readonly names: readonly string[];
  /** `allowedTools` for the query: the `tau` glob, the exact tools of the chosen servers (read-only ones when writes ask first), the always-allowed tools. */
  readonly allowedTools: readonly string[];
}

const TAU_TOOLS_GLOB = "mcp__tau__*";

const isChosen = (settings: ClaudeConnectorSettings, server: ClaudeMcpServerStatus): boolean =>
  server.status === "connected" && settings.enabled.includes(server.name);

const readOnlyToolNamesOf = (server: ClaudeMcpServerStatus): string[] =>
  server.tools
    .filter((tool) => tool.readOnly)
    .map((tool) => `${connectorToolPrefixOf(server.name)}${tool.name}`);

const allToolNamesOf = (server: ClaudeMcpServerStatus): string[] =>
  server.tools.map((tool) => `${connectorToolPrefixOf(server.name)}${tool.name}`);

const autoAllowedToolNamesOf = (
  settings: ClaudeConnectorSettings,
  server: ClaudeMcpServerStatus,
): string[] => (settings.askBeforeWrites ? readOnlyToolNamesOf(server) : allToolNamesOf(server));

const belongsTo = (chosen: readonly ClaudeMcpServerStatus[], cliToolName: string): boolean =>
  chosen.some((server) => cliToolName.startsWith(connectorToolPrefixOf(server.name)));

export function chooseServers(
  settings: ClaudeConnectorSettings,
  status: readonly ClaudeMcpServerStatus[],
): ChosenServers {
  const chosen = status.filter((server) => isChosen(settings, server));
  if (chosen.length === 0) return { names: [], allowedTools: [] };
  const alwaysAllowed = settings.alwaysAllow.filter((name) => belongsTo(chosen, name));
  const allowedTools = [
    TAU_TOOLS_GLOB,
    ...chosen.flatMap((server) => autoAllowedToolNamesOf(settings, server)),
    ...alwaysAllowed,
  ];
  return { names: chosen.map((server) => server.name), allowedTools: [...new Set(allowedTools)] };
}

/** One glob for every claude.ai server that is not chosen, so its schemas stay out of the context. */
export const disallowedToolsOf = (
  chosenNames: readonly string[],
  status: readonly ClaudeMcpServerStatus[],
): string[] =>
  status
    .filter((server) => isClaudeAiServer(server.name) && !chosenNames.includes(server.name))
    .map((server) => connectorAllowGlobOf(server.name));
