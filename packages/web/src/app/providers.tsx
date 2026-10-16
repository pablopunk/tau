import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createLiveClient, LiveClientProvider } from "@/conversation";
import { api } from "@/lib/api";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [liveClient] = useState(() => createLiveClient(api.live));
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <LiveClientProvider client={liveClient}>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </LiveClientProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
