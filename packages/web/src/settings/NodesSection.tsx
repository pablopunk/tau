import { Separator } from "@/components/ui/separator";
import { useHubLink } from "@/lib/queries";
import { ConnectNodeRow } from "./ConnectNodeRow";
import { HubLinkRow } from "./HubLinkRow";
import { NodesList } from "./NodesList";

/** This node and the nodes linked to it, "Connect a node", and "Linked to <hub>" on a linked node. */
export function NodesSection() {
  const link = useHubLink().data;
  const linked = link !== undefined && link.state !== "none";
  return (
    <>
      <NodesList />
      <Separator />
      {linked ? null : (
        <>
          <ConnectNodeRow />
          <Separator />
        </>
      )}
      <HubLinkRow />
    </>
  );
}
