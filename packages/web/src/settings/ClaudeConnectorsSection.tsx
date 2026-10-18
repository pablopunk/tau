import type { ClaudeConnector } from "@tau/protocol";
import { Badge } from "@/components/ui/badge";
import { FieldDescription } from "@/components/ui/field";
import { SettingRow } from "@/components/ui/settings-layout";
import { Switch } from "@/components/ui/switch";
import { useProviders, useSetClaudeConnectors, useSettings } from "@/lib/queries";
import {
  CONNECT_ON_CLAUDE_AI,
  CONNECTORS_NOTE,
  connectorBadge,
  connectorCounts,
  NOT_AVAILABLE_NOTE,
  needsConnecting,
  withServerEnabled,
} from "./ClaudeConnectorsText";

interface RowProps {
  readonly connector: ClaudeConnector;
  readonly enabled: boolean;
  readonly disabled: boolean;
  readonly onToggle: (on: boolean) => void;
}

function ConnectorRow({ connector, enabled, disabled, onToggle }: RowProps) {
  const badge = connectorBadge(connector);
  const needsAuth = needsConnecting(connector);
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{connector.name}</span>
          {badge ? <Badge variant="secondary">{badge}</Badge> : null}
        </div>
        <FieldDescription>{needsAuth ? CONNECT_ON_CLAUDE_AI : connectorCounts(connector)}</FieldDescription>
      </div>
      {needsAuth ? null : (
        <Switch
          aria-label={connector.name}
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onToggle}
        />
      )}
    </li>
  );
}

export function ClaudeConnectorsSection() {
  const providers = useProviders();
  const settings = useSettings();
  const save = useSetClaudeConnectors();
  const cli = providers.data?.find((provider) => provider.id === "claude-cli")?.cli;
  const connectors = cli?.state === "ready" ? cli.connectors : null;
  const current = settings.data?.claudeConnectors;
  const available = connectors !== null && connectors.length > 0 && current !== undefined;
  return (
    <SettingRow id="claude-connectors" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Claude connectors</h3>
      <FieldDescription>{available ? CONNECTORS_NOTE : NOT_AVAILABLE_NOTE}</FieldDescription>
      {available ? (
        <ul aria-label="Claude connectors" className="flex flex-col gap-2">
          {connectors.map((connector) => (
            <ConnectorRow
              key={connector.name}
              connector={connector}
              enabled={current.enabled.includes(connector.name)}
              disabled={save.isPending}
              onToggle={(on) => save.mutate(withServerEnabled(current, connector.name, on))}
            />
          ))}
        </ul>
      ) : null}
    </SettingRow>
  );
}
