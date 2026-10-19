import type { DirectoryNode } from "@tau/protocol";
import { MoreHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The destructive actions of a node: Disconnect (both ends told) and Forget (this node only). */
export function NodeMenu({
  node,
  onDisconnect,
  onForget,
  onRemove,
}: {
  node: DirectoryNode;
  onDisconnect: (node: DirectoryNode) => void;
  onForget: (node: DirectoryNode) => void;
  onRemove: (node: DirectoryNode) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`More actions for ${node.name}`}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {node.direct ? (
          <>
            <DropdownMenuItem onSelect={() => onDisconnect(node)}>Disconnect</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onForget(node)}>Forget on this node</DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuItem variant="destructive" onSelect={() => onRemove(node)}>
          Remove from the group
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
