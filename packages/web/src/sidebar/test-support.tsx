import type { ConversationSummary, Project } from "@pi-everywhere/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";

export const project = (overrides: Partial<Project> = {}): Project => ({
  id: "p1",
  name: "Home",
  path: "/home",
  createdAt: 1,
  kind: "home",
  status: "ready",
  ...overrides,
});

export const conversation = (overrides: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: "c1",
  projectId: "p1",
  title: "First thread",
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  status: "idle",
  lastRunEndedAt: null,
  ...overrides,
});

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

export function renderAt(path: string, ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <TooltipProvider>{ui}</TooltipProvider>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}
