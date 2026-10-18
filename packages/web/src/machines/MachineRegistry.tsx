import { useQuery } from "@tanstack/react-query";
import type { Machine } from "@tau/protocol";
import { type Api, api as hubApi } from "@/lib/api";
import { queryKeys } from "@/lib/queries";
import { apiOfMachine } from "./machine-apis";

export interface MachineRegistry {
  /** The machines linked to this hub, with their status. The hub's own machine is not in the list. */
  readonly machines: readonly Machine[];
  readonly isLoading: boolean;
}

/**
 * For components outside one machine's provider (the new-thread project picker, notifications, the Machines page,
 * the command palette). Reads the hub's own list; it must sit under the hub's `QueryClientProvider`.
 */
export function useMachines(): MachineRegistry {
  const { data = [], isLoading } = useQuery({
    queryKey: queryKeys.machines,
    queryFn: () => hubApi.machines.list(),
  });
  return { machines: data, isLoading };
}

/** The typed client of any machine by id (`undefined`: the hub's own). No provider needed. */
export const useMachineApi = (machineId?: string): Api => apiOfMachine(machineId);
