import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConversationSummary, Project } from "@tau/protocol";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NodeApiProvider } from "@/nodes/node-context";

export const project = (overrides: Partial<Project> = {}): Project => ({
  id: "p1",
  name: "Home",
  path: "/home",
  createdAt: 1,
  kind: "home",
  status: "ready",
  isGitRepo: false,
  ...overrides,
});

export const conversation = (overrides: Partial<ConversationSummary> = {}): ConversationSummary => ({
  avatarIndex: Number(overrides.id) || 1,
  lastActivityAt: overrides.lastRunEndedAt ?? overrides.updatedAt ?? 1,
  id: "c1",
  projectId: "p1",
  title: "First thread",
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  status: "idle",
  lastRunEndedAt: null,
  model: null,
  workspace: {
    mode: "checkout",
    path: "/p",
    branch: null,
    base: null,
    state: "ready",
    mergedSha: null,
    pullRequestUrl: null,
  },
  forkOf: null,
  parentId: null,
  agentType: null,
  agentModel: null,
  agentStatus: null,
  background: false,
  agentThinking: null,
  timers: 0,
  nextTimerAt: null,
  goal: null,
  unmergedWarning: null,
  ...overrides,
});

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

export function renderAt(path: string, ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <NodeApiProvider>
        <MemoryRouter initialEntries={[path]}>
          <TooltipProvider>{ui}</TooltipProvider>
          <LocationProbe />
        </MemoryRouter>
      </NodeApiProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}
