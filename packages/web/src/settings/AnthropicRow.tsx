import type { ClaudeCliStatus, ProviderInfo } from "@tau/protocol";
import { useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Badge } from "@/components/ui/badge";
import {
  ProviderListDetail,
  ProviderListName,
  ProviderListRow,
  ProviderListStatus,
} from "@/components/ui/provider-list";
import { SettingRow } from "@/components/ui/settings-layout";
import { useAcknowledgeClaudeCli, useInstallClaudeCliSdk, useRefreshClaudeCli } from "@/lib/queries";
import { ClaudeCliNotice } from "./ClaudeCliNotice";
import {
  type ClaudeCliAction,
  claudeCliAction,
  claudeCliActionLabel,
  claudeCliBadge,
  claudeCliLoginNote,
  claudeCliNote,
  claudeCliPendingLabel,
  isUsageWarning,
} from "./ClaudeCliText";
import { ProviderActionButtons, type ProviderActionItem } from "./ProviderActionButtons";
import { ProviderKeyForm } from "./ProviderKeyForm";
import { DisconnectConfirmation } from "./ProviderRow";
import { connectedNote, connectionLabel, isConnected, isStored, keyActionLabel } from "./provider-status";

const QUIET_STATES: ClaudeCliStatus["state"][] = ["missing", "logged_out", "not_plan"];

const isCliConnected = (cli: ClaudeCliStatus): boolean => cli.state === "ready";

const needsCliStep = (cli: ClaudeCliStatus): boolean =>
  cli.state === "needs_notice" || cli.state === "sdk_missing";

const joinNotes = (notes: (string | null)[]): string => notes.filter(Boolean).join(" · ");

const apiKeyNote = (api: ProviderInfo): string | null =>
  isConnected(api) ? (api.connection?.source === "env" ? connectedNote(api) : "API key") : null;

const activeNote = (api: ProviderInfo, cli: ClaudeCliStatus): string =>
  joinNotes([isCliConnected(cli) ? claudeCliLoginNote(cli) : null, apiKeyNote(api)]);

interface Presentation {
  label: string;
  badge: { text: string; destructive: boolean } | null;
  note: string | null;
}

const badgePresentation = (text: string, destructive: boolean, note: string | null): Presentation => ({
  label: text,
  badge: { text, destructive },
  note,
});

function presentation(api: ProviderInfo, cli: ClaudeCliStatus): Presentation {
  if (isConnected(api) || isCliConnected(cli)) {
    const note = activeNote(api, cli);
    return { label: note, badge: null, note };
  }
  if (api.connection)
    return badgePresentation(connectionLabel(api), api.connection.valid === false, "Uses an API key.");
  if (QUIET_STATES.includes(cli.state)) return badgePresentation("Not connected", false, claudeCliNote(cli));
  const badge = claudeCliBadge(cli);
  return badgePresentation(badge.label, badge.destructive, claudeCliNote(cli));
}

function ConnectionStatus({ api, cli }: { api: ProviderInfo; cli: ClaudeCliStatus }) {
  const { label, badge, note } = presentation(api, cli);
  const noteClass = isUsageWarning(cli) ? "text-amber-600 dark:text-amber-400" : undefined;
  return (
    <ProviderListStatus label={label} note={note ? <span className={noteClass}>{note}</span> : null}>
      {badge ? (
        <Badge variant={badge.destructive ? "destructive" : "secondary"} className="min-w-0 justify-start">
          <span className="truncate">{badge.text}</span>
        </Badge>
      ) : null}
    </ProviderListStatus>
  );
}

export function AnthropicRow({ api, cliProvider }: { api: ProviderInfo; cliProvider: ProviderInfo }) {
  const cli = cliProvider.cli;
  const acknowledge = useAcknowledgeClaudeCli();
  const refresh = useRefreshClaudeCli();
  const install = useInstallClaudeCliSdk();
  const { run, error, pending } = useSubmit();
  const [editingKey, setEditingKey] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  if (!cli) return null;

  const mutations = { acknowledge, refresh, install };
  const runCli = (action: ClaudeCliAction) => run(async () => void (await mutations[action].mutateAsync()));
  const cliAction = claudeCliAction(cli);
  const pendingLabel = pending ? claudeCliPendingLabel(cliAction) : null;

  const cliStep: ProviderActionItem[] = needsCliStep(cli)
    ? [
        {
          id: cliAction,
          label: pendingLabel ?? claudeCliActionLabel(cliAction),
          disabled: pending,
          onSelect: () => runCli(cliAction),
        },
      ]
    : [];
  const keyActions: ProviderActionItem[] = [
    { id: "key", label: keyActionLabel(api), onSelect: () => setEditingKey((open) => !open) },
  ];
  if (isStored(api))
    keyActions.push({
      id: "disconnect",
      label: "Disconnect key",
      destructive: true,
      onSelect: () => setDisconnecting(true),
    });
  const checkAgain: ProviderActionItem[] = needsCliStep(cli)
    ? []
    : [{ id: "refresh", label: "Check again", disabled: pending, onSelect: () => runCli("refresh") }];

  return (
    <SettingRow id={`provider:${api.id}`} asChild>
      <ProviderListRow aria-label={api.name} className="rounded-none!">
        <ProviderListName name={api.name} connected={isConnected(api) || isCliConnected(cli)} />
        <ConnectionStatus api={api} cli={cli} />
        <ProviderActionButtons name={api.name} actions={[...cliStep, ...keyActions, ...checkAgain]} />
        {cli.state === "needs_notice" ? (
          <ProviderListDetail>
            <ClaudeCliNotice />
          </ProviderListDetail>
        ) : null}
        {editingKey ? (
          <ProviderListDetail>
            <ProviderKeyForm provider={api} onSaved={() => setEditingKey(false)} />
          </ProviderListDetail>
        ) : null}
        {disconnecting ? (
          <ProviderListDetail>
            <DisconnectConfirmation provider={api} onCancel={() => setDisconnecting(false)} />
          </ProviderListDetail>
        ) : null}
        {error ? (
          <ProviderListDetail>
            <FormError message={error} />
          </ProviderListDetail>
        ) : null}
      </ProviderListRow>
    </SettingRow>
  );
}
