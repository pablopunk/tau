import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MachineApiProvider } from "@/machines/machine-context";

export function ComposerTestWrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <MachineApiProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </MachineApiProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}
