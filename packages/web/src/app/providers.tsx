import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NodeProvider } from "@/nodes";

/** The hub's own node is the root provider: no URL prefix, today's behaviour. Linked nodes nest their own. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <NodeProvider>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </NodeProvider>
  );
}
