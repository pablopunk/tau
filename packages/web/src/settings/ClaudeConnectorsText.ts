import type { ClaudeConnector, ClaudeConnectorSettings } from "@tau/protocol";

const STATUS_BADGE: Partial<Record<ClaudeConnector["status"], string>> = {
  needs_auth: "Needs sign-in",
  failed: "Failed",
  disabled: "Disabled",
  pending: "Connecting",
};

export const CONNECTORS_NOTE = "Connectors from your Claude account, for Claude CLI models.";
export const NOT_AVAILABLE_NOTE = "Connectors show up here once a Claude CLI login is ready.";

export const ASK_BEFORE_WRITES_LABEL = "Ask before writes";
export const ASK_BEFORE_WRITES_NOTE = "When on, tools that change things ask you first.";

export const connectorDisplayName = (name: string): string => name.replace(/^claude\.ai /, "");

export const needsSignIn = (connector: ClaudeConnector): boolean =>
  connector.status === "needs_auth" || connector.status === "failed";

export const signInGroupTitle = (count: number): string => `Needs sign-in (${count})`;

const byDisplayName = (a: ClaudeConnector, b: ClaudeConnector): number =>
  connectorDisplayName(a.name).localeCompare(connectorDisplayName(b.name));

export const connectedConnectors = (connectors: readonly ClaudeConnector[]): ClaudeConnector[] =>
  connectors.filter((connector) => !needsSignIn(connector)).sort(byDisplayName);

export const signInConnectors = (connectors: readonly ClaudeConnector[]): ClaudeConnector[] =>
  connectors.filter(needsSignIn).sort(byDisplayName);

export const withAskBeforeWrites = (
  settings: ClaudeConnectorSettings,
  on: boolean,
): ClaudeConnectorSettings => ({
  ...settings,
  askBeforeWrites: on,
});

export const CONNECT_ON_CLAUDE_AI = "Connect it on claude.ai";

export const connectorBadge = (connector: ClaudeConnector): string | null =>
  STATUS_BADGE[connector.status] ?? null;

export const connectorCounts = (connector: ClaudeConnector): string =>
  `${connector.toolCount} tools · ${connector.readOnlyCount} read-only`;

export const needsConnecting = needsSignIn;

export function withServerEnabled(
  settings: ClaudeConnectorSettings,
  name: string,
  on: boolean,
): ClaudeConnectorSettings {
  const others = settings.enabled.filter((entry) => entry !== name);
  return { ...settings, enabled: on ? [...others, name] : others };
}
