import type { Machine } from "@tau/protocol";
import { PROTOCOL_VERSION } from "@tau/protocol";
import { useState } from "react";
import { FormError } from "@/app/FormError";
import { useSubmit } from "@/app/use-submit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  MachineDot,
  MachineList,
  MachineOsIcon,
  MachineRow,
  MachineRowActions,
  MachineRowBody,
} from "@/components/ui/machine-row";
import { SettingRow } from "@/components/ui/settings-layout";
import { useAllConversations, useDisconnectMachine, useHubLink, useRenameMachine } from "@/lib/queries";
import { useMachines } from "@/machines";
import { osLabel, stateLine, updateCommand } from "@/machines/machine-text";
import { MachineSettingsDialog } from "./MachineSettingsDialog";

function RenameForm({ machine, onDone }: { machine: Machine; onDone: () => void }) {
  const rename = useRenameMachine();
  const { run, error, pending } = useSubmit();
  const [name, setName] = useState(machine.name);
  const save = async () => {
    const next = name.trim();
    if (!next || next === machine.name) return onDone();
    if (await run(async () => void (await rename.mutateAsync({ id: machine.id, name: next })))) onDone();
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
          aria-label="Machine name"
          autoFocus
          value={name}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
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

const short = (version: string) => version.slice(0, 8);

function UpdateNote({ machine }: { machine: Machine }) {
  return (
    <div className="flex flex-col gap-1 pt-1 text-xs text-muted-foreground">
      <p>
        Update tau on {machine.name}: it runs tau {machine.tauVersion} (protocol{" "}
        {short(machine.protocolVersion)}
        ), this one speaks protocol {short(PROTOCOL_VERSION)}.
      </p>
      <div className="flex items-center gap-1">
        <code className="rounded-md bg-muted px-2 py-1">{updateCommand}</code>
        <CopyButton text={updateCommand} label="Copy update command" />
      </div>
    </div>
  );
}

function MachineItem({
  machine,
  now,
  onDisconnect,
  onSettings,
}: {
  machine: Machine;
  now: number;
  onDisconnect: (machine: Machine) => void;
  onSettings: (machine: Machine) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <MachineRow data-machine-id={machine.id}>
      <MachineOsIcon os={machine.os} />
      {renaming ? (
        <div className="min-w-0 flex-1">
          <RenameForm machine={machine} onDone={() => setRenaming(false)} />
        </div>
      ) : (
        <>
          <MachineRowBody>
            <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <MachineDot status={machine.status} />
              <span className="truncate">{machine.name}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {osLabel(machine.os)} · tau {machine.tauVersion} · {machine.threadCount}{" "}
              {machine.threadCount === 1 ? "thread" : "threads"} · {stateLine(machine, now)}
            </span>
            {machine.status === "update-required" ? <UpdateNote machine={machine} /> : null}
          </MachineRowBody>
          <MachineRowActions>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Open settings of ${machine.name}`}
              disabled={machine.status !== "online"}
              onClick={() => onSettings(machine)}
            >
              Open settings
            </Button>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Rename ${machine.name}`}
              onClick={() => setRenaming(true)}
            >
              Rename
            </Button>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Disconnect ${machine.name}`}
              onClick={() => onDisconnect(machine)}
            >
              Disconnect
            </Button>
          </MachineRowActions>
        </>
      )}
    </MachineRow>
  );
}

function ThisMachineRow() {
  const threads = useAllConversations().data?.length ?? 0;
  const link = useHubLink().data;
  const hubName = link && link.state !== "none" ? (link.hubName ?? link.hubUrl ?? "a hub") : null;
  return (
    <MachineRow data-machine-id="local">
      <MachineOsIcon os="" />
      <MachineRowBody>
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <MachineDot status="online" />
          <span className="truncate">This machine</span>
          {hubName ? null : <Badge variant="secondary">Hub</Badge>}
        </span>
        <span className="text-xs text-muted-foreground">
          {threads} {threads === 1 ? "thread" : "threads"} · the tau you are looking at
          {hubName ? `, linked to ${hubName}` : ""}
        </span>
      </MachineRowBody>
    </MachineRow>
  );
}

export function MachinesList() {
  const { machines } = useMachines();
  const disconnect = useDisconnectMachine();
  const { run, error } = useSubmit();
  const [leaving, setLeaving] = useState<Machine | null>(null);
  const [settingsOf, setSettingsOf] = useState<Machine | null>(null);
  const now = Date.now();
  return (
    <SettingRow id="machines">
      <div className="flex flex-col gap-3">
        <FieldLabel>Machines</FieldLabel>
        <MachineList aria-label="Machines">
          <ThisMachineRow />
          {machines.map((machine) => (
            <MachineItem
              key={machine.id}
              machine={machine}
              now={now}
              onDisconnect={setLeaving}
              onSettings={setSettingsOf}
            />
          ))}
        </MachineList>
        {machines.length === 0 ? <FieldDescription>No other machine is linked yet.</FieldDescription> : null}
        <FormError message={error} />
      </div>
      <ConfirmDialog
        open={leaving !== null}
        onOpenChange={(open) => !open && setLeaving(null)}
        title={`Disconnect ${leaving?.name ?? "machine"}?`}
        description="It disappears from this tau and must connect again with a new code. Its threads stay on that machine."
        confirmLabel="Disconnect"
        onConfirm={() => {
          const id = leaving?.id;
          setLeaving(null);
          if (id) void run(async () => void (await disconnect.mutateAsync(id)));
        }}
      />
      {settingsOf ? <MachineSettingsDialog machine={settingsOf} onClose={() => setSettingsOf(null)} /> : null}
    </SettingRow>
  );
}
