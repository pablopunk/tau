import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MachineProvider } from "@/machines";

/** The hub's own machine is the root provider: no URL prefix, today's behaviour. Linked machines nest their own. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <MachineProvider>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </MachineProvider>
  );
}
