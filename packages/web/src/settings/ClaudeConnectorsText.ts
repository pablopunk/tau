import type { ClaudeConnector, ClaudeConnectorSettings } from "@tau/protocol";

const STATUS_BADGE: Partial<Record<ClaudeConnector["status"], string>> = {
  needs_auth: "Needs sign-in",
  failed: "Failed",
  disabled: "Disabled",
  pending: "Connecting",
};

export const CONNECTORS_NOTE = "Connectors from your Claude account, for Claude CLI models.";
export const NOT_AVAILABLE_NOTE = "Connectors show up here once a Claude CLI login is ready.";

export const CONNECT_ON_CLAUDE_AI = "Connect it on claude.ai";

export const connectorBadge = (connector: ClaudeConnector): string | null =>
  STATUS_BADGE[connector.status] ?? null;

export const connectorCounts = (connector: ClaudeConnector): string =>
  `${connector.toolCount} tools · ${connector.readOnlyCount} read-only`;

export const needsConnecting = (connector: ClaudeConnector): boolean => connector.status === "needs_auth";

export function withServerEnabled(
  settings: ClaudeConnectorSettings,
  name: string,
  on: boolean,
): ClaudeConnectorSettings {
  const others = settings.enabled.filter((entry) => entry !== name);
  return { ...settings, enabled: on ? [...others, name] : others };
}
