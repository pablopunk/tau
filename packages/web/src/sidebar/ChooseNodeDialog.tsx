import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NodeAvatar } from "@/components/ui/node-avatar";
import { NodeName } from "@/components/ui/node-name";
import type { NodeData } from "@/nodes";

/** "Add project" with several nodes asks first: whose disk is the folder on? */
export function ChooseNodeDialog({
  nodes,
  onChoose,
  onClose,
}: {
  nodes: readonly NodeData[];
  onChoose: (nodeId: string | undefined) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Which node?</DialogTitle>
          <DialogDescription>The project folder lives on one node. Pick it.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {nodes.map((node) => (
            <Button
              key={node.nodeId ?? "local"}
              variant="outline"
              className="justify-start"
              onClick={() => onChoose(node.nodeId)}
            >
              <NodeAvatar os={node.os} status={node.status} />
              <NodeName name={node.name} local={node.local} />
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
