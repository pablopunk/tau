import { CommandGroup, CommandItem } from "@/components/ui/command";
import { MachineAvatar } from "@/components/ui/machine-avatar";
import type { MachineData } from "@/machines";

export interface MachinePick {
  heading: string;
  onPick: (machineId: string | undefined) => void;
}

const openFirst = (machines: readonly MachineData[], openMachineId: string | undefined) => [
  ...machines.filter((machine) => machine.machineId === openMachineId),
  ...machines.filter((machine) => machine.machineId !== openMachineId),
];

/** The palette's machine page: an action that could run on several machines asks which one. The open thread's machine comes first. */
export function MachinePage({
  machines,
  openMachineId,
  pick,
  run,
}: {
  machines: readonly MachineData[];
  openMachineId: string | undefined;
  pick: MachinePick;
  run: (action: () => void) => () => void;
}) {
  return (
    <CommandGroup heading={pick.heading}>
      {openFirst(machines, openMachineId).map((machine) => (
        <CommandItem
          key={machine.machineId ?? "local"}
          value={`machine ${machine.name}`}
          onSelect={run(() => pick.onPick(machine.machineId))}
        >
          <MachineAvatar os={machine.os} status={machine.status} />
          {machine.name}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
