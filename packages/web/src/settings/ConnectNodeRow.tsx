import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SettingRow } from "@/components/ui/settings-layout";
import { CONNECT_POWER_NOTE } from "@/nodes/node-text";
import { ConnectNodeDialog } from "./ConnectNodeDialog";

export function ConnectNodeRow() {
  const [open, setOpen] = useState(false);
  return (
    <SettingRow id="connect-node">
      <Field className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>Connect a node to this node</FieldLabel>
          <Button
            variant="outline"
            size="sm"
            aria-label="Connect a node to this node"
            onClick={() => setOpen(true)}
          >
            Connect a node
          </Button>
        </div>
        <FieldDescription>{CONNECT_POWER_NOTE}</FieldDescription>
      </Field>
      <ConnectNodeDialog open={open} onOpenChange={setOpen} />
    </SettingRow>
  );
}
