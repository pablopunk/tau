import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { NodeName } from "@/components/ui/node-name";
import { OsIcon } from "@/components/ui/os-icon";
import { useAllConversations } from "@/lib/queries";
import { useNodeId } from "@/nodes/node-context";
import { useNodeAvatar } from "@/nodes/use-node-avatar";
import { useNodeName } from "@/nodes/use-node-name";

export function ThreadHeader({ id, extras }: { id: string; extras?: ReactNode }) {
  const title = useAllConversations().data?.find((summary) => summary.id === id)?.title || "Conversation";
  const nodeId = useNodeId();
  const nodeName = useNodeName(nodeId);
  const avatar = useNodeAvatar(nodeId);
  return (
    <header className="flex min-w-0 items-center gap-2 border-b px-4 py-2">
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
      {nodeName ? (
        <Badge variant="outline">
          <OsIcon os={avatar.os} className="text-muted-foreground" />
          <NodeName name={nodeName} local={nodeId === undefined} />
        </Badge>
      ) : null}
      {extras}
    </header>
  );
}
