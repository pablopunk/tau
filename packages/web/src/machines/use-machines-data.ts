import { useQueries } from "@tanstack/react-query";
import type { ConversationSummary, MachineStatus, Project } from "@tau/protocol";
import { useMemo } from "react";
import { byActivity, queryKeys } from "@/lib/queries";
import { useHubQueryClient } from "./hub-client";
import { useMachines } from "./MachineRegistry";
import { apiOfMachine } from "./machine-apis";
import { isUsable } from "./machine-text";
import { useHubName, useHubOs } from "./use-machine-avatar";

const REMOTE_REFRESH_MS = 15_000;

export interface MachineData {
  /** `undefined`: the hub's own machine. */
  readonly machineId: string | undefined;
  readonly name: string;
  /** The hub's own machine: its name is shown with a dim "local". */
  readonly local: boolean;
  readonly os: string | undefined;
  readonly status: MachineStatus;
  readonly projects: readonly Project[];
  readonly conversations: readonly ConversationSummary[];
}

/**
 * Projects and threads of every reachable machine, for components outside one machine's provider (the command
 * palette, notifications, the new-thread project picker). The hub's own machine shares the hub cache
 * (live); linked machines are cached in the hub's client under `["machine-data", id, ...]`, so they cannot mix with a machine's own cache, and refreshed every 15 s (a machine's
 * own sidebar group stays live through its provider).
 */
export function useMachinesData(): MachineData[] {
  const { machines } = useMachines();
  const hub = useHubQueryClient();
  const hubOs = useHubOs();
  const hubName = useHubName();
  const localApi = apiOfMachine();
  const remote = machines.filter(isUsable);
  const results = useQueries(
    {
      queries: [
        { queryKey: queryKeys.projects, queryFn: () => localApi.projects.list() },
        {
          queryKey: queryKeys.allConversations,
          queryFn: async () => (await localApi.conversations.listAll()).sort(byActivity),
        },
        ...remote.flatMap((machine) => [
          {
            queryKey: [...queryKeys.machineData(machine.id), "projects"],
            queryFn: () => apiOfMachine(machine.id).projects.list(),
            refetchInterval: REMOTE_REFRESH_MS,
          },
          {
            queryKey: [...queryKeys.machineData(machine.id), "conversations"],
            queryFn: async () => (await apiOfMachine(machine.id).conversations.listAll()).sort(byActivity),
            refetchInterval: REMOTE_REFRESH_MS,
          },
        ]),
      ],
    },
    hub,
  );
  const signature = results.map((result) => result.dataUpdatedAt).join(",");
  const remoteKey = remote.map((machine) => `${machine.id}:${machine.name}`).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `signature` and `remoteKey` stand for the results and machines
  return useMemo(() => {
    const local: MachineData = {
      machineId: undefined,
      name: hubName,
      local: true,
      os: hubOs,
      status: "online",
      projects: (results[0]?.data as Project[] | undefined) ?? [],
      conversations: (results[1]?.data as ConversationSummary[] | undefined) ?? [],
    };
    const others = remote.map((machine, index): MachineData => {
      return {
        machineId: machine.id,
        name: machine.name,
        local: false,
        os: machine.os,
        status: machine.status,
        projects: (results[2 + index * 2]?.data as Project[] | undefined) ?? [],
        conversations: (results[3 + index * 2]?.data as ConversationSummary[] | undefined) ?? [],
      };
    });
    return [local, ...others];
  }, [signature, remoteKey, hubOs, hubName]);
}
