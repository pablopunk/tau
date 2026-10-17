import type { ProviderInfo } from "@pi-everywhere/protocol";
import { useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldDescription } from "@/components/ui/field";
import { useDisconnectProvider } from "@/lib/queries";
import { ChatGptLoginDialog } from "./ChatGptLoginDialog";
import { ProviderKeyForm } from "./ProviderKeyForm";
import {
  CHATGPT_COPY,
  canSignInWithChatGpt,
  connectionLabel,
  ENV_HELP,
  isFromEnvironment,
  isStored,
  keyActionLabel,
} from "./provider-status";

function DisconnectButton({ provider }: { provider: ProviderInfo }) {
  const [confirming, setConfirming] = useState(false);
  const disconnect = useDisconnectProvider();
  const { run, error, pending } = useSubmit();

  if (!confirming) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Disconnect
      </Button>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="text-sm">Disconnect {provider.name}?</span>
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() => run(async () => void (await disconnect.mutateAsync(provider.id)))}
        >
          Confirm disconnect
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
      <FormError message={error} />
    </div>
  );
}

export function ProviderRow({ provider }: { provider: ProviderInfo }) {
  const [editingKey, setEditingKey] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const connected = provider.connection !== null;

  return (
    <li aria-label={provider.name} className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{provider.name}</span>
          <Badge variant={connected ? "default" : "secondary"}>{connectionLabel(provider)}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSignInWithChatGpt(provider) ? (
            <Button variant="outline" size="sm" onClick={() => setSigningIn(true)}>
              Sign in with ChatGPT
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setEditingKey((open) => !open)}>
            {keyActionLabel(provider)}
          </Button>
          {isStored(provider) ? <DisconnectButton provider={provider} /> : null}
        </div>
      </div>
      {isFromEnvironment(provider) ? <FieldDescription>{ENV_HELP}</FieldDescription> : null}
      {canSignInWithChatGpt(provider) ? <FieldDescription>{CHATGPT_COPY}</FieldDescription> : null}
      {editingKey ? <ProviderKeyForm provider={provider} onSaved={() => setEditingKey(false)} /> : null}
      {signingIn ? <ChatGptLoginDialog onClose={() => setSigningIn(false)} /> : null}
    </li>
  );
}
