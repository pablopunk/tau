import { Separator } from "@/components/ui/separator";
import { ConnectMachineRow } from "./ConnectMachineRow";
import { HubLinkRow } from "./HubLinkRow";
import { MachinesList } from "./MachinesList";

/** This machine and the machines linked to it, "Connect a machine", and "Linked to <hub>" on a linked machine. */
export function MachinesSection() {
  return (
    <>
      <MachinesList />
      <Separator />
      <ConnectMachineRow />
      <Separator />
      <HubLinkRow />
    </>
  );
}
