import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SettingRow } from "@/components/ui/settings-layout";
import { CONNECT_POWER_NOTE } from "@/machines/machine-text";
import { ConnectMachineDialog } from "./ConnectMachineDialog";

export function ConnectMachineRow() {
  const [open, setOpen] = useState(false);
  return (
    <SettingRow id="connect-machine">
      <Field className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>Connect a machine</FieldLabel>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Connect a machine
          </Button>
        </div>
        <FieldDescription>{CONNECT_POWER_NOTE}</FieldDescription>
      </Field>
      <ConnectMachineDialog open={open} onOpenChange={setOpen} />
    </SettingRow>
  );
}
