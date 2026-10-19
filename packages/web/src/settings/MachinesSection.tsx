import { Separator } from "@/components/ui/separator";
import { useHubLink } from "@/lib/queries";
import { ConnectMachineRow } from "./ConnectMachineRow";
import { HubLinkRow } from "./HubLinkRow";
import { MachinesList } from "./MachinesList";

/** This machine and the machines linked to it, "Connect a machine", and "Linked to <hub>" on a linked machine. */
export function MachinesSection() {
  const link = useHubLink().data;
  const linked = link !== undefined && link.state !== "none";
  return (
    <>
      <MachinesList />
      <Separator />
      {linked ? null : (
        <>
          <ConnectMachineRow />
          <Separator />
        </>
      )}
      <HubLinkRow />
    </>
  );
}
