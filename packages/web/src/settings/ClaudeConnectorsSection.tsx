import type { ClaudeConnector, ClaudeConnectorSettings } from "@tau/protocol";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FieldDescription } from "@/components/ui/field";
import { SettingRow } from "@/components/ui/settings-layout";
import { Switch } from "@/components/ui/switch";
import { useProviders, useSetClaudeConnectors, useSettings } from "@/lib/queries";
import {
  ASK_BEFORE_WRITES_LABEL,
  ASK_BEFORE_WRITES_NOTE,
  CONNECT_ON_CLAUDE_AI,
  CONNECTORS_NOTE,
  connectedConnectors,
  connectorBadge,
  connectorCounts,
  connectorDisplayName,
  isServerOn,
  NOT_AVAILABLE_NOTE,
  needsConnecting,
  signInConnectors,
  signInGroupTitle,
  withAskBeforeWrites,
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
          <span className="truncate text-sm font-medium">{connectorDisplayName(connector.name)}</span>
          {badge ? <Badge variant="secondary">{badge}</Badge> : null}
        </div>
        <FieldDescription>{needsAuth ? CONNECT_ON_CLAUDE_AI : connectorCounts(connector)}</FieldDescription>
      </div>
      {needsAuth ? null : (
        <Switch
          aria-label={connectorDisplayName(connector.name)}
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onToggle}
        />
      )}
    </li>
  );
}

interface AskBeforeWritesProps {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onToggle: (on: boolean) => void;
}

function AskBeforeWritesRow({ checked, disabled, onToggle }: AskBeforeWritesProps) {
  return (
    <SettingRow id="claude-ask-before-writes" className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{ASK_BEFORE_WRITES_LABEL}</span>
        <FieldDescription>{ASK_BEFORE_WRITES_NOTE}</FieldDescription>
      </div>
      <Switch
        aria-label={ASK_BEFORE_WRITES_LABEL}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onToggle}
      />
    </SettingRow>
  );
}

interface ListProps {
  readonly connectors: readonly ClaudeConnector[];
  readonly current: ClaudeConnectorSettings;
  readonly disabled: boolean;
  readonly onSave: (value: ClaudeConnectorSettings) => void;
  readonly label: string;
}

function ConnectorList({ connectors, current, disabled, onSave, label }: ListProps) {
  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {connectors.map((connector) => (
        <ConnectorRow
          key={connector.name}
          connector={connector}
          enabled={isServerOn(current, connector.name)}
          disabled={disabled}
          onToggle={(on) => onSave(withServerEnabled(current, connector.name, on))}
        />
      ))}
    </ul>
  );
}

function SignInGroup(props: ListProps) {
  return (
    <Collapsible className="flex flex-col gap-2">
      <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium">
        <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
        {signInGroupTitle(props.connectors.length)}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ConnectorList {...props} />
      </CollapsibleContent>
    </Collapsible>
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
      {current ? (
        <AskBeforeWritesRow
          checked={current.askBeforeWrites}
          disabled={save.isPending}
          onToggle={(on) => save.mutate(withAskBeforeWrites(current, on))}
        />
      ) : null}
      <FieldDescription>{available ? CONNECTORS_NOTE : NOT_AVAILABLE_NOTE}</FieldDescription>
      {available ? (
        <>
          <ConnectorList
            label="Claude connectors"
            connectors={connectedConnectors(connectors)}
            current={current}
            disabled={save.isPending}
            onSave={(value) => save.mutate(value)}
          />
          {signInConnectors(connectors).length > 0 ? (
            <SignInGroup
              label="Needs sign-in"
              connectors={signInConnectors(connectors)}
              current={current}
              disabled={save.isPending}
              onSave={(value) => save.mutate(value)}
            />
          ) : null}
        </>
      ) : null}
    </SettingRow>
  );
}
