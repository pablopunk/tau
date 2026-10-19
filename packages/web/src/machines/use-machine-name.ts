import { useMachines } from "./MachineRegistry";
import { isUsable } from "./machine-text";
import { useHubName } from "./use-machine-avatar";

/**
 * The name to show next to a thread, but only when more than one machine is online (the hub's own counts as one);
 * with a single machine the name is just noise.
 */
export function useMachineName(machineId: string | undefined): string | undefined {
  const { machines } = useMachines();
  const hubName = useHubName();
  const online = machines.filter(isUsable);
  if (online.length === 0) return undefined;
  if (machineId === undefined) return hubName;
  return machines.find((machine) => machine.id === machineId)?.name;
}
