import { createContext, type ReactNode, useContext, useState } from "react";
import type { Api } from "@/lib/api";
import { apiOfMachine } from "./machine-apis";

interface MachineContextValue {
  /** `undefined` on the hub's own machine. */
  readonly machineId: string | undefined;
  readonly api: Api;
}

const MachineContext = createContext<MachineContextValue | undefined>(undefined);

/** Only the machine context: for tests and callers that bring their own `QueryClient`. */
export function MachineApiProvider({
  machineId,
  api,
  children,
}: {
  readonly machineId?: string;
  readonly api?: Api;
  readonly children: ReactNode;
}) {
  const [value] = useState<MachineContextValue>(() => ({ machineId, api: api ?? apiOfMachine(machineId) }));
  return <MachineContext.Provider value={value}>{children}</MachineContext.Provider>;
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
