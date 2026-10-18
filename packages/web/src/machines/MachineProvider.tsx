import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useState } from "react";
import { createLiveClient, LiveClientProvider } from "@/conversation";
import type { Api } from "@/lib/api";
import { useChangedInvalidation } from "@/lib/use-changed-invalidation";
import { apiOfMachine } from "./machine-apis";

interface MachineContextValue {
  /** `undefined` on the hub's own machine. */
  readonly machineId: string | undefined;
  readonly api: Api;
}

const MachineContext = createContext<MachineContextValue | undefined>(undefined);

function ChangedInvalidation() {
  useChangedInvalidation();
  return null;
}

export interface MachineProviderProps {
  /** Absent: the hub's own machine, no URL prefix. */
  readonly machineId?: string;
  readonly children: ReactNode;
}

/**
 * Everything one machine owns: its `api` (a `Transport` that adds `/api/m/<id>`), its own `QueryClient` (keys cannot
 * leak across machines) and its own `LiveClient`. Hooks and `queryFn`s read the api with `useApi()`, never the
 * imported singleton (the grep gate in `lib/api-singleton.test.ts` enforces it, file by file).
 */
export function MachineProvider({ machineId, children }: MachineProviderProps) {
  const [value] = useState<MachineContextValue>(() => ({ machineId, api: apiOfMachine(machineId) }));
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [liveClient] = useState(() => createLiveClient(value.api.live));
  return (
    <MachineContext.Provider value={value}>
      <QueryClientProvider client={queryClient}>
        <LiveClientProvider client={liveClient}>
          <ChangedInvalidation />
          {children}
        </LiveClientProvider>
      </QueryClientProvider>
    </MachineContext.Provider>
  );
}

function useMachineContext(): MachineContextValue {
  const value = useContext(MachineContext);
  if (!value) throw new Error("useApi and useMachineId need a MachineProvider");
  return value;
}

/** The api of the machine whose provider is above. */
export const useApi = (): Api => useMachineContext().api;

/** `undefined` on the hub's own machine. */
export const useMachineId = (): string | undefined => useMachineContext().machineId;
