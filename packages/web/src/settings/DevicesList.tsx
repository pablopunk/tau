import type { Device } from "@tau/protocol";
import { useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DeviceKindIcon,
  DeviceList,
  DeviceRow,
  DeviceRowActions,
  DeviceRowBody,
} from "@/components/ui/device-row";
import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RelativeTime } from "@/components/ui/relative-time";
import { SettingRow } from "@/components/ui/settings-layout";
import { useDevices, useRenameDevice, useRevokeDevice, useSignOutAllDevices } from "@/lib/queries";

function RenameForm({ device, onDone }: { device: Device; onDone: () => void }) {
  const rename = useRenameDevice();
  const { run, error, pending } = useSubmit();
  const [name, setName] = useState(device.name);
  const save = async () => {
    const next = name.trim();
    if (!next || next === device.name) return onDone();
    if (await run(async () => void (await rename.mutateAsync({ id: device.id, name: next })))) onDone();
  };
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="flex items-center gap-1">
        <Input
          aria-label="Device name"
          autoFocus
          value={name}
          disabled={pending}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <FormError message={error} />
    </form>
  );
}

function DeviceItem({ device, onRevoke }: { device: Device; onRevoke: (device: Device) => void }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <DeviceRow>
      <DeviceKindIcon kind={device.kind} />
      {renaming ? (
        <div className="min-w-0 flex-1">
          <RenameForm device={device} onDone={() => setRenaming(false)} />
        </div>
      ) : (
        <>
          <DeviceRowBody>
            <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <span className="truncate">{device.name}</span>
              {device.current ? <Badge variant="secondary">This device</Badge> : null}
            </span>
            <span className="text-xs text-muted-foreground">
              Last seen <RelativeTime at={device.lastSeenAt} />
            </span>
          </DeviceRowBody>
          <DeviceRowActions>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Rename ${device.name}`}
              onClick={() => setRenaming(true)}
            >
              Rename
            </Button>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Revoke ${device.name}`}
              onClick={() => onRevoke(device)}
            >
              Revoke
            </Button>
          </DeviceRowActions>
        </>
      )}
    </DeviceRow>
  );
}

export function DevicesSection() {
  const devices = useDevices().data ?? [];
  const revoke = useRevokeDevice();
  const signOutAll = useSignOutAllDevices();
  const { run, error } = useSubmit();
  const [revoking, setRevoking] = useState<Device | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const hasPeople = devices.some((device) => device.kind !== "node");
  return (
    <SettingRow id="devices">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>Devices</FieldLabel>
          {hasPeople ? (
            <Button variant="outline" size="sm" onClick={() => setSigningOut(true)}>
              Sign out all
            </Button>
          ) : null}
        </div>
        {devices.length === 0 ? (
          <FieldDescription>No devices are linked yet.</FieldDescription>
        ) : (
          <DeviceList aria-label="Devices">
            {devices.map((device) => (
              <DeviceItem key={device.id} device={device} onRevoke={setRevoking} />
            ))}
          </DeviceList>
        )}
        <FormError message={error} />
      </div>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke ${revoking?.name ?? "device"}?`}
        description="This device is signed out at once and must pair again to come back."
        confirmLabel="Revoke"
        onConfirm={() => {
          const id = revoking?.id;
          setRevoking(null);
          if (id) void run(async () => void (await revoke.mutateAsync(id)));
        }}
      />
      <ConfirmDialog
        open={signingOut}
        onOpenChange={setSigningOut}
        title="Sign out all devices?"
        description="Every linked device, including this one if it came through the URL, must pair again. Linked nodes stay connected."
        confirmLabel="Sign out all"
        onConfirm={() => {
          setSigningOut(false);
          void run(async () => void (await signOutAll.mutateAsync()));
        }}
      />
    </SettingRow>
  );
}
