import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { NodeName } from "@/components/ui/node-name";
import { OsIcon } from "@/components/ui/os-icon";
import { useAllConversations } from "@/lib/queries";
import { useNodeId } from "@/nodes/node-context";
import { useNodeAvatar } from "@/nodes/use-node-avatar";
import { useNodeName } from "@/nodes/use-node-name";
import { useHeaderSlot } from "@/routes/header-slot";

export function ThreadHeader({
  id,
  extras,
  actions,
}: {
  id: string;
  extras?: ReactNode;
  actions?: ReactNode;
}) {
  const title = useAllConversations().data?.find((summary) => summary.id === id)?.title || "Conversation";
  const nodeId = useNodeId();
  const nodeName = useNodeName(nodeId);
  const avatar = useNodeAvatar(nodeId);
  const slot = useHeaderSlot();
  const machine = nodeName ? (
    <Badge variant="outline" className="min-w-0">
      <OsIcon os={avatar.os} className="text-muted-foreground" />
      <NodeName name={nodeName} local={nodeId === undefined} />
    </Badge>
  ) : null;
  return (
    <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2">
      <h1 className="min-w-32 flex-1 truncate text-sm font-medium">{title}</h1>
      {actions ? <div className="order-1 flex shrink-0 items-center sm:order-3">{actions}</div> : null}
      <div className="order-2 flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full">
        {slot ? null : machine}
        {extras}
      </div>
      {slot && machine ? createPortal(machine, slot) : null}
    </header>
  );
}
