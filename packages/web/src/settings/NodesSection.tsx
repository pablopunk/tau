import { Separator } from "@/components/ui/separator";
import { ConnectNodeRow } from "./ConnectNodeRow";
import { NodesList } from "./NodesList";

/** Every node this tau is linked to, in either direction, and "Connect a node" for this one. */
export function NodesSection() {
  return (
    <>
      <NodesList />
      <Separator />
      <ConnectNodeRow />
    </>
  );
}
