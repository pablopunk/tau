import { Badge } from "@/components/ui/badge";
import { NodeName } from "@/components/ui/node-name";
import { OsIcon } from "@/components/ui/os-icon";
import { useNodeId } from "@/nodes/node-context";
import { useNodeAvatar } from "@/nodes/use-node-avatar";
import { useNodeName } from "@/nodes/use-node-name";
import { SidebarSection } from "./SidebarSection";

export function MachineSection() {
  const nodeId = useNodeId();
  const nodeName = useNodeName(nodeId);
  const avatar = useNodeAvatar(nodeId);
  if (!nodeName) return null;
  return (
    <SidebarSection sectionId="node" title="Node">
      <Badge variant="outline">
        <OsIcon os={avatar.os} className="text-muted-foreground" />
        <NodeName name={nodeName} local={nodeId === undefined} />
      </Badge>
    </SidebarSection>
  );
}
