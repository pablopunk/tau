export const CONNECTOR_TOOL_NAME = "claude_connector";

const MCP_PREFIX = "mcp__";
const CLAUDE_AI_SEGMENT_PREFIX = "claude_ai_";
const CLAUDE_AI_TOOL_PREFIX = `${MCP_PREFIX}${CLAUDE_AI_SEGMENT_PREFIX}`;
const SEGMENT_SEPARATOR = "__";
const SERVER_NAME_PREFIX = "claude.ai ";

export interface ConnectorCall {
  readonly server: string;
  readonly tool: string;
}

const normalizedSegment = (name: string): string => name.replace(/[^a-zA-Z0-9_-]/g, "_");

/** `claude.ai Linear` (the name in `mcpServerStatus()`) becomes the segment the CLI puts in tool names. */
export const cliServerSegmentOf = (statusName: string): string => normalizedSegment(statusName);

/** `claude.ai Google Calendar` becomes `Google_Calendar`, the `server` argument of `claude_connector`. */
export const connectorServerOf = (statusName: string): string =>
  cliServerSegmentOf(statusName).replace(new RegExp(`^${CLAUDE_AI_SEGMENT_PREFIX}`), "");

export const connectorToolPrefixOf = (statusName: string): string =>
  `${MCP_PREFIX}${cliServerSegmentOf(statusName)}${SEGMENT_SEPARATOR}`;

/** The `allowedTools` glob for every tool of one server. */
export const connectorAllowGlobOf = (statusName: string): string => `${connectorToolPrefixOf(statusName)}*`;

/** The CLI tool name of a read-only or allowed tool: `mcp__claude_ai_Linear__list_teams`. */
export const cliToolNameOf = (call: ConnectorCall): string =>
  `${CLAUDE_AI_TOOL_PREFIX}${call.server}${SEGMENT_SEPARATOR}${call.tool}`;

/** Only claude.ai connectors map to `claude_connector`; the in-process `tau` server and user servers do not. */
export const isConnectorToolName = (cliToolName: string): boolean =>
  cliToolName.startsWith(CLAUDE_AI_TOOL_PREFIX) && parseConnectorToolName(cliToolName) !== null;

export function parseConnectorToolName(cliToolName: string): ConnectorCall | null {
  if (!cliToolName.startsWith(CLAUDE_AI_TOOL_PREFIX)) return null;
  const rest = cliToolName.slice(CLAUDE_AI_TOOL_PREFIX.length);
  const split = rest.indexOf(SEGMENT_SEPARATOR);
  if (split <= 0) return null;
  const tool = rest.slice(split + SEGMENT_SEPARATOR.length);
  return tool === "" ? null : { server: rest.slice(0, split), tool };
}

/** What a tool card shows for `Google_Calendar`: `Google Calendar`. */
export const serverLabelOf = (server: string): string => server.replaceAll("_", " ");

export const isClaudeAiServer = (statusName: string): boolean => statusName.startsWith(SERVER_NAME_PREFIX);

/** The CLI's built-in tool that loads deferred connector schemas on demand. */
export const TOOL_SEARCH_CLI_NAME = "ToolSearch";

/** `server` of the `claude_connector` step a `ToolSearch` call becomes; the web shows it as a small lookup step. */
export const TOOL_SEARCH_SERVER = "Tool search";

/** The CLI runs these itself and tau only observes them: connector tools and `ToolSearch`. */
export const isObservedToolName = (cliToolName: string): boolean =>
  cliToolName === TOOL_SEARCH_CLI_NAME || isConnectorToolName(cliToolName);

/** The `claude_connector` call an observed CLI tool call is shown as. */
export const observedCallOf = (cliToolName: string): ConnectorCall | null =>
  cliToolName === TOOL_SEARCH_CLI_NAME
    ? { server: TOOL_SEARCH_SERVER, tool: "search" }
    : parseConnectorToolName(cliToolName);
