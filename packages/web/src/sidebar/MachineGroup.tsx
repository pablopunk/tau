import type { Machine } from "@tau/protocol";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MachineAvatar } from "@/components/ui/machine-avatar";
import type { MachineDotStatus } from "@/components/ui/machine-row";
import { SidebarGroup, SidebarGroupLabel } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHubOs } from "@/machines/use-machine-avatar";
import { useCollapsedMachines } from "./use-sidebar-preferences";

interface MachineGroupProps {
  /** `undefined`: the hub's own machine. */
  machine: Machine | undefined;
  /** The label of the group: this machine's name, or "This machine". */
  name: string;
  children: ReactNode;
}

/** The header of one machine's group: OS icon with status, name, collapsible. */
export function MachineGroup({ machine, name, children }: MachineGroupProps) {
  const { isOpen, setOpen } = useCollapsedMachines();
  const key = machine?.id ?? "local";
  const hubOs = useHubOs();
  const os = machine ? machine.os : hubOs;
  const status: MachineDotStatus = machine?.status ?? "online";
  const open = isOpen(key);
  return (
    <SidebarGroup role="group" aria-label={name} data-machine={key} data-status={status}>
      <Collapsible open={open} onOpenChange={(next) => setOpen(key, next)}>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger className="w-full gap-1.5">
            <ChevronRightIcon className={open ? "rotate-90 transition-transform" : "transition-transform"} />
            {status === "update-required" ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <MachineAvatar os={os} status={status} />
                </TooltipTrigger>
                <TooltipContent side="right">Update tau on {name}</TooltipContent>
              </Tooltip>
            ) : (
              <MachineAvatar os={os} status={status} />
            )}
            <span className="truncate">{name}</span>
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
}
