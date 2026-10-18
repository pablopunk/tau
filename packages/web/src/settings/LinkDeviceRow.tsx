import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SettingRow } from "@/components/ui/settings-layout";
import { useRemoteStatus } from "@/lib/queries";
import { LinkDeviceDialog } from "./LinkDeviceDialog";
import { FULL_POWER_NOTE } from "./RemoteText";

export function LinkDeviceRow() {
  const [open, setOpen] = useState(false);
  const online = useRemoteStatus().data?.state === "online";
  return (
    <SettingRow id="link-device">
      <Field className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>Link a device</FieldLabel>
          <Button variant="outline" size="sm" disabled={!online} onClick={() => setOpen(true)}>
            Link a device
          </Button>
        </div>
        <FieldDescription>
          {online ? FULL_POWER_NOTE : "Turn on remote access, and wait until it is online, to link a device."}
        </FieldDescription>
      </Field>
      <LinkDeviceDialog open={open} onOpenChange={setOpen} />
    </SettingRow>
  );
}
