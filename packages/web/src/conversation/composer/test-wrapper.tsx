import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";

export function ComposerTestWrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}
