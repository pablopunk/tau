import { CommandGroup, CommandItem } from "@/components/ui/command";
import { NodeAvatar } from "@/components/ui/node-avatar";
import type { NodeData } from "@/nodes";

export interface NodePick {
  heading: string;
  onPick: (nodeId: string | undefined) => void;
}

const openFirst = (nodes: readonly NodeData[], openNodeId: string | undefined) => [
  ...nodes.filter((node) => node.nodeId === openNodeId),
  ...nodes.filter((node) => node.nodeId !== openNodeId),
];

/** The palette's node page: an action that could run on several nodes asks which one. The open thread's node comes first. */
export function NodePage({
  nodes,
  openNodeId,
  pick,
  run,
}: {
  nodes: readonly NodeData[];
  openNodeId: string | undefined;
  pick: NodePick;
  run: (action: () => void) => () => void;
}) {
  return (
    <CommandGroup heading={pick.heading}>
      {openFirst(nodes, openNodeId).map((node) => (
        <CommandItem
          key={node.nodeId ?? "local"}
          value={`node ${node.name}`}
          onSelect={run(() => pick.onPick(node.nodeId))}
        >
          <NodeAvatar os={node.os} status={node.status} />
          {node.name}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
