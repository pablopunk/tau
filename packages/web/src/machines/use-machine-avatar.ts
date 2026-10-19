import { useQuery } from "@tanstack/react-query";
import type { MachineStatus } from "@tau/protocol";
import { queryKeys } from "@/lib/queries";
import { useHubQueryClient } from "./hub-client";
import { localNodeName } from "./local-node-name";
import { useMachines } from "./MachineRegistry";
import { apiOfMachine } from "./machine-apis";

/** The OS and name of the hub itself, read from the hub's cache even inside a linked machine's provider. */
function useHubInfo() {
  const client = useHubQueryClient();
  const { data } = useQuery(
    { queryKey: queryKeys.hubLink, queryFn: () => apiOfMachine().machines.hubLink() },
    client,
  );
  return data;
}

export const useHubOs = (): string | undefined => useHubInfo()?.os;

/** The hub's own name ("Mac"), never empty. */
export const useHubName = (): string => localNodeName(useHubInfo()?.name);

/** OS and status of a machine by id (`undefined`: the hub's own, always online). */
export function useMachineAvatar(machineId: string | undefined): {
  os: string | undefined;
  status: MachineStatus;
} {
  const { machines } = useMachines();
  const hubOs = useHubOs();
  if (machineId === undefined) return { os: hubOs, status: "online" };
  const machine = machines.find((candidate) => candidate.id === machineId);
  return { os: machine?.os, status: machine?.status ?? "offline" };
}
