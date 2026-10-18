import type { ProviderInfo } from "@tau/protocol";
import { useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ProviderListDetail,
  ProviderListName,
  ProviderListRow,
  ProviderListStatus,
} from "@/components/ui/provider-list";
import { SettingRow } from "@/components/ui/settings-layout";
import { useDisconnectProvider } from "@/lib/queries";
import { ChatGptLoginDialog } from "./ChatGptLoginDialog";
import { ClaudeCliRow } from "./ClaudeCliRow";
import { ProviderActionButtons } from "./ProviderActionButtons";
import { ProviderKeyForm } from "./ProviderKeyForm";
import {
  actionLabel,
  connectedNote,
  connectedTooltip,
  connectionLabel,
  isConnected,
  type ProviderAction,
  providerActions,
  providerDescription,
} from "./provider-status";

export function DisconnectConfirmation({
  provider,
  onCancel,
}: {
  provider: ProviderInfo;
  onCancel: () => void;
}) {
  const disconnect = useDisconnectProvider();
  const { run, error, pending } = useSubmit();
  return (
    <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">Disconnect {provider.name}?</span>
        <div className="flex items-center gap-2">
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => run(async () => void (await disconnect.mutateAsync(provider.id)))}
          >
            Confirm disconnect
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
      <FormError message={error} />
    </div>
  );
}

function ProviderStatus({ provider }: { provider: ProviderInfo }) {
  if (isConnected(provider))
    return <ProviderListStatus label={connectedTooltip(provider)} note={connectedNote(provider)} />;
  const label = connectionLabel(provider);
  const variant = provider.connection?.valid === false ? "destructive" : "secondary";
  return (
    <ProviderListStatus label={label} note={providerDescription(provider)}>
      <Badge variant={variant} className="min-w-0 justify-start">
        <span className="truncate">{label}</span>
      </Badge>
    </ProviderListStatus>
  );
}

function ProviderActions({
  provider,
  onAction,
}: {
  provider: ProviderInfo;
  onAction: (action: ProviderAction) => void;
}) {
  const actions = providerActions(provider).map((action) => ({
    id: action,
    label: actionLabel(action, provider),
    destructive: action === "disconnect",
    onSelect: () => onAction(action),
  }));
  return <ProviderActionButtons name={provider.name} actions={actions} />;
}

function ApiProviderRow({ provider }: { provider: ProviderInfo }) {
  const [editingKey, setEditingKey] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const perform = (action: ProviderAction) => {
    if (action === "sign-in") setSigningIn(true);
    if (action === "key") setEditingKey((open) => !open);
    if (action === "disconnect") setDisconnecting(true);
  };

  return (
    <SettingRow id={`provider:${provider.id}`} asChild>
      <ProviderListRow aria-label={provider.name} className="rounded-none!">
        <ProviderListName name={provider.name} connected={isConnected(provider)} />
        <ProviderStatus provider={provider} />
        <ProviderActions provider={provider} onAction={perform} />
        {editingKey ? (
          <ProviderListDetail>
            <ProviderKeyForm provider={provider} onSaved={() => setEditingKey(false)} />
          </ProviderListDetail>
        ) : null}
        {disconnecting ? (
          <ProviderListDetail>
            <DisconnectConfirmation provider={provider} onCancel={() => setDisconnecting(false)} />
          </ProviderListDetail>
        ) : null}
        {signingIn ? <ChatGptLoginDialog onClose={() => setSigningIn(false)} /> : null}
      </ProviderListRow>
    </SettingRow>
  );
}

export function ProviderRow({ provider }: { provider: ProviderInfo }) {
  return provider.cli ? <ClaudeCliRow provider={provider} /> : <ApiProviderRow provider={provider} />;
}
