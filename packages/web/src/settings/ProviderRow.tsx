import type { ProviderInfo } from "@tau/protocol";
import { MoreHorizontalIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ProviderListActions,
  ProviderListDetail,
  ProviderListName,
  ProviderListRow,
  ProviderListStatus,
} from "@/components/ui/provider-list";
import { SettingRow } from "@/components/ui/settings-layout";
import { useDisconnectProvider } from "@/lib/queries";
import { ChatGptLoginDialog } from "./ChatGptLoginDialog";
import { ProviderKeyForm } from "./ProviderKeyForm";
import {
  actionLabel,
  connectionLabel,
  type ProviderAction,
  providerActions,
  providerDescription,
} from "./provider-status";

function DisconnectConfirmation({ provider, onCancel }: { provider: ProviderInfo; onCancel: () => void }) {
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

function ProviderStatus({ provider, note }: { provider: ProviderInfo; note?: ReactNode }) {
  const label = connectionLabel(provider);
  const variant =
    provider.connection?.valid === false ? "destructive" : provider.connection ? "default" : "secondary";
  return (
    <ProviderListStatus label={label} note={note}>
      <Badge variant={variant} className="min-w-0 justify-start">
        <span className="truncate">{label}</span>
      </Badge>
    </ProviderListStatus>
  );
}

interface ActionsProps {
  provider: ProviderInfo;
  onAction: (action: ProviderAction) => void;
}

function ProviderActions({ provider, onAction }: ActionsProps) {
  const [primary, ...secondary] = providerActions(provider);
  const nameFor = (action: ProviderAction) => `${actionLabel(action, provider)} for ${provider.name}`;
  return (
    <ProviderListActions>
      {primary ? (
        <Button variant="outline" size="sm" aria-label={nameFor(primary)} onClick={() => onAction(primary)}>
          {actionLabel(primary, provider)}
        </Button>
      ) : null}
      {secondary.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${provider.name}`}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            {secondary.map((action) => (
              <DropdownMenuItem
                key={action}
                variant={action === "disconnect" ? "destructive" : "default"}
                aria-label={nameFor(action)}
                onSelect={() => onAction(action)}
              >
                {actionLabel(action, provider)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span aria-hidden className="hidden size-7 sm:block" />
      )}
    </ProviderListActions>
  );
}

export function ProviderRow({ provider }: { provider: ProviderInfo }) {
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
        <ProviderListName name={provider.name} />
        <ProviderStatus provider={provider} note={providerDescription(provider)} />
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
