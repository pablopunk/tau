import type { ReactNode } from "react";
import { MachineProvider } from "./MachineProvider";

/** A linked machine's page runs under that machine's provider; the hub's own machine is the root provider. */
export function MachineScope({ machineId, children }: { machineId?: string; children: ReactNode }) {
  if (machineId === undefined) return children;
  return (
    <MachineProvider key={machineId} machineId={machineId}>
      {children}
    </MachineProvider>
  );
}
