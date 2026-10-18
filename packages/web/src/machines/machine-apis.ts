import { type Api, createApi, api as localApi } from "@/lib/api";
import { createMachineTransport } from "@/lib/transport/machine";

const cache = new Map<string, Api>();

/**
 * The typed client of one machine. `undefined` is the hub's own machine: today's `api`, no prefix.
 * One client per machine id for the page's life (its transport holds no state, sockets are opened on demand).
 */
export function apiOfMachine(machineId?: string): Api {
  if (machineId === undefined) return localApi;
  let machineApi = cache.get(machineId);
  if (!machineApi) {
    machineApi = createApi(createMachineTransport(machineId));
    cache.set(machineId, machineApi);
  }
  return machineApi;
}

export const forgetMachineApis = (): void => cache.clear();
