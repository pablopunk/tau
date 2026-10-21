import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { NodeName } from "@/components/ui/node-name";
import { OsIcon } from "@/components/ui/os-icon";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAllConversations, useGoal } from "@/lib/queries";
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
  const summary = useAllConversations().data?.find((item) => item.id === id);
  const title = summary?.title || "Conversation";
  const goal = useGoal(id).data;
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
  // Mirror the chips below: the row renders only when at least one chip will.
  const hasChips =
    machine != null ||
    goal != null ||
    (summary?.workspace?.mode === "worktree" && summary.workspace.state !== "removed");
  return (
    <header className="shrink-0">
      {/* Mobile: a single compact bar; the app bar above stays hidden on thread pages. */}
      <div className="flex h-12 items-center gap-1 border-b px-1 md:hidden">
        <SidebarTrigger aria-label="Open sidebar" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
        {actions}
      </div>
      <div className="hidden min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 md:flex">
        <h1 className="min-w-32 flex-1 truncate text-sm font-medium">{title}</h1>
        {actions ? <div className="order-1 flex shrink-0 items-center sm:order-3">{actions}</div> : null}
        <div className="order-2 flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full">
          {slot ? null : machine}
          {extras}
        </div>
        {slot && machine ? createPortal(machine, slot) : null}
      </div>
      {hasChips ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 md:hidden">
          {machine}
          {extras}
        </div>
      ) : null}
    </header>
  );
}
