import { useEffect, useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { SettingRow } from "@/components/ui/settings-layout";
import { StatusChip } from "@/components/ui/status-chip";
import { Switch } from "@/components/ui/switch";
import { useDisableRemote, useEnableRemote, useRecreateRemote, useRemoteStatus } from "@/lib/queries";
import { chipFor, OFF_CONFIRM, RECREATE_CONFIRM, SLEEP_NOTE, stateNote, uptimeText } from "./RemoteText";

function useTick(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
}

type Confirm = "off" | "recreate" | null;

function RemoteUrl({ url }: { url: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <code className="min-w-0 truncate rounded-md bg-muted px-2 py-1 text-xs">{url}</code>
      <CopyButton text={url} label="Copy URL" />
    </div>
  );
}

export function RemoteAccessRow() {
  const status = useRemoteStatus().data;
  useTick(status?.state === "starting");
  const enable = useEnableRemote();
  const disable = useDisableRemote();
  const recreate = useRecreateRemote();
  const { run, error, pending } = useSubmit();
  const [confirm, setConfirm] = useState<Confirm>(null);
  if (!status) return <SettingRow id="remote-access">Remote access</SettingRow>;
  const on = status.state !== "off";
  const chip = chipFor(status.state);
  const note = stateNote(status);
  const uptime = uptimeText(status, Date.now());
  const toggle = (next: boolean) =>
    next ? run(async () => void (await enable.mutateAsync())) : setConfirm("off");
  const confirmed = () => {
    const action = confirm === "off" ? disable : recreate;
    setConfirm(null);
    void run(async () => void (await action.mutateAsync()));
  };
  return (
    <SettingRow id="remote-access">
      <Field className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel htmlFor="remote-switch">Remote access</FieldLabel>
          <div className="flex items-center gap-2">
            <StatusChip tone={chip.tone} loading={status.state === "starting"}>
              {chip.label}
            </StatusChip>
            <Switch id="remote-switch" checked={on} disabled={pending} onCheckedChange={toggle} />
          </div>
        </div>
        <FieldDescription>
          Open tau from your phone or another computer through a private URL.
        </FieldDescription>
        {status.url ? <RemoteUrl url={status.url} /> : null}
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
        {uptime ? <p className="text-sm text-muted-foreground">{uptime}</p> : null}
        {on ? <FieldDescription>{SLEEP_NOTE}</FieldDescription> : null}
        {status.pendingRemoval ? (
          <FieldDescription>
            An old URL is still being removed. It finishes when the network allows.
          </FieldDescription>
        ) : null}
        {status.canRecreate ? (
          <div>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setConfirm("recreate")}>
              Make a new URL
            </Button>
          </div>
        ) : null}
        <FormError message={error} />
      </Field>
      <ConfirmDialog
        open={confirm === "off"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Turn off remote access?"
        description={OFF_CONFIRM}
        confirmLabel="Turn off"
        onConfirm={confirmed}
      />
      <ConfirmDialog
        open={confirm === "recreate"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Make a new URL?"
        description={RECREATE_CONFIRM}
        confirmLabel="Make a new URL"
        onConfirm={confirmed}
      />
    </SettingRow>
  );
}
