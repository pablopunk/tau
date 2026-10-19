import type { Machine } from "@tau/protocol";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MachineDot, type MachineDotStatus } from "@/components/ui/machine-row";
import { SidebarGroup, SidebarGroupLabel } from "@/components/ui/sidebar";
import { useCollapsedMachines } from "./use-sidebar-preferences";

interface MachineGroupProps {
  /** `undefined`: the hub's own machine. */
  machine: Machine | undefined;
  /** The label of the group: this machine's name, or "This machine". */
  name: string;
  children: ReactNode;
}

/** The header of one machine's group: online dot, name, collapsible. */
export function MachineGroup({ machine, name, children }: MachineGroupProps) {
  const { isOpen, setOpen } = useCollapsedMachines();
  const key = machine?.id ?? "local";
  const status: MachineDotStatus = machine?.status ?? "online";
  const open = isOpen(key);
  return (
    <SidebarGroup role="group" aria-label={name} data-machine={key} data-status={status}>
      <Collapsible open={open} onOpenChange={(next) => setOpen(key, next)}>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger className="w-full gap-1.5">
            <ChevronRightIcon className={open ? "rotate-90 transition-transform" : "transition-transform"} />
            <MachineDot status={status} />
            <span className="truncate">{name}</span>
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
}
