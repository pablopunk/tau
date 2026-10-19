import { useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SettingRow } from "@/components/ui/settings-layout";
import type { HubLinkView } from "@/lib/hub-link";
import { useDisconnectHub, useHubLink } from "@/lib/queries";

const STATE_TEXT: Record<HubLinkView["state"], string> = {
  none: "",
  connecting: "Connecting…",
  linked: "Linked",
  reconnecting: "Reconnecting…",
  unreachable: "Hub unreachable",
  "update-required": "Update tau on the hub",
  refused: "The hub refused this node",
  duplicate: "Duplicate identity",
  standby: "Standing by",
};

const hubLabel = (link: HubLinkView) => link.hubName ?? link.hubUrl ?? "a hub";

function describe(link: HubLinkView): string {
  if (link.state === "none") return "This node is not linked to a hub.";
  return link.message ?? STATE_TEXT[link.state];
}

export function HubLinkRow() {
  const link = useHubLink().data;
  const disconnect = useDisconnectHub();
  const { run, error } = useSubmit();
  const [confirming, setConfirming] = useState(false);
  const linked = link !== undefined && link.state !== "none";
  return (
    <SettingRow id="hub-link">
      <Field className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>{linked ? `Linked to ${hubLabel(link)}` : "Linked to a hub"}</FieldLabel>
          {linked ? (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
              Disconnect
            </Button>
          ) : null}
        </div>
        <FieldDescription>{link ? describe(link) : "Checking…"}</FieldDescription>
        <FormError message={error} />
      </Field>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Disconnect from ${link ? hubLabel(link) : "the hub"}?`}
        description="The hub can no longer see or use this node. Connect again with a new code to come back."
        confirmLabel="Disconnect"
        onConfirm={() => {
          setConfirming(false);
          void run(async () => void (await disconnect.mutateAsync()));
        }}
      />
    </SettingRow>
  );
}
