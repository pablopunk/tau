import type { Node } from "@tau/protocol";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { NodeAvatar } from "@/components/ui/node-avatar";
import { NodeName } from "@/components/ui/node-name";
import type { NodeDotStatus } from "@/components/ui/node-row";
import { SidebarGroup, SidebarGroupLabel } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHubOs } from "@/nodes/use-node-avatar";
import { useCollapsedNodes } from "./use-sidebar-preferences";

interface NodeGroupProps {
  /** `undefined`: the hub's own node. */
  node: Node | undefined;
  /** The label of the group: the node's name. */
  name: string;
  /** Shows a dim "local" after the name. */
  local?: boolean;
  children: ReactNode;
}

/** The header of one node's group: OS icon with status, name, collapsible. */
export function NodeGroup({ node, name, local, children }: NodeGroupProps) {
  const { isOpen, setOpen } = useCollapsedNodes();
  const key = node?.id ?? "local";
  const hubOs = useHubOs();
  const os = node ? node.os : hubOs;
  const status: NodeDotStatus = node?.status ?? "online";
  const open = isOpen(key);
  return (
    <SidebarGroup
      role="group"
      aria-label={name}
      data-node={key}
      data-status={status}
      className="rounded-md has-[>div>[data-group-header]:hover]:bg-sidebar-accent"
    >
      <Collapsible open={open} onOpenChange={(next) => setOpen(key, next)}>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger data-group-header className="w-full cursor-pointer gap-1.5">
            {status === "update-required" ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <NodeAvatar os={os} status={status} />
                </TooltipTrigger>
                <TooltipContent side="right">Update tau on {name}</TooltipContent>
              </Tooltip>
            ) : (
              <NodeAvatar os={os} status={status} />
            )}
            <NodeName name={name} local={local} />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
}
