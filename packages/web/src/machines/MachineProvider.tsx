import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { createLiveClient, type LiveClient, LiveClientProvider } from "@/conversation";
import type { Api } from "@/lib/api";
import { useChangedInvalidation } from "@/lib/use-changed-invalidation";
import { HubClientProvider } from "./hub-client";
import { apiOfMachine } from "./machine-apis";
import { MachineApiProvider } from "./machine-context";

function ChangedInvalidation() {
  useChangedInvalidation();
  return null;
}

export interface MachineProviderProps {
  /** Absent: the hub's own machine, no URL prefix. */
  readonly machineId?: string;
  readonly children: ReactNode;
}

interface MachineClients {
  readonly queryClient: QueryClient;
  readonly liveClient: LiveClient;
}

const remoteClients = new Map<string, MachineClients>();

function createClients(api: Api): MachineClients {
  return {
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    liveClient: createLiveClient(api.live),
  };
}

/** A linked machine keeps one cache and one live client for the page's life, shared by its sidebar group and its thread. */
function clientsOf(machineId: string | undefined, api: Api): MachineClients {
  if (machineId === undefined) return createClients(api);
  let clients = remoteClients.get(machineId);
  if (!clients) {
    clients = createClients(api);
    remoteClients.set(machineId, clients);
  }
  return clients;
}

export const forgetMachineClients = (): void => remoteClients.clear();

/**
 * Everything one machine owns: its `api` (a `Transport` that adds `/api/m/<id>`), its own `QueryClient` (keys cannot
 * leak across machines) and its own `LiveClient`. Hooks and `queryFn`s read the api with `useApi()`, never the
 * singleton. The hub's own provider also publishes its client for `useMachines()`.
 */
export function MachineProvider({ machineId, children }: MachineProviderProps) {
  const [api] = useState(() => apiOfMachine(machineId));
  const [{ queryClient, liveClient }] = useState(() => clientsOf(machineId, api));
  return (
    <MachineApiProvider machineId={machineId} api={api}>
      <QueryClientProvider client={queryClient}>
        <HubClientProvider isHub={machineId === undefined} client={queryClient}>
          <LiveClientProvider client={liveClient}>
            <ChangedInvalidation />
            {children}
          </LiveClientProvider>
        </HubClientProvider>
      </QueryClientProvider>
    </MachineApiProvider>
  );
}
