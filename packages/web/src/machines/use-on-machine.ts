import { useMachines } from "./MachineRegistry";
import { useMachineId } from "./machine-context";

/** " on Homelab" inside a linked machine's provider, "" on the hub's own machine: folder pickers say whose disk they browse. */
export function useOnMachine(): string {
  const machineId = useMachineId();
  const { machines } = useMachines();
  if (machineId === undefined) return "";
  const name = machines.find((machine) => machine.id === machineId)?.name;
  return name ? ` on ${name}` : " on that machine";
}
