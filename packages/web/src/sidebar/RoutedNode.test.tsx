import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DirectoryNode } from "@tau/protocol";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NodeApiProvider } from "@/nodes";
import { writeSummaryCache } from "@/nodes/summary-cache";
import { NodeGroup } from "./NodeGroup";
import { OfflineNodeSection } from "./OfflineNodeSection";

const routed: DirectoryNode = {
  id: "c",
  identified: true,
  name: "Work laptop",
  os: "darwin",
  tauVersion: "0.2.0",
  protocolVersion: "same",
  status: "offline",
  lastSeenAt: Date.now() - 3_600_000,
  threadCount: 1,
  links: [],
  direct: false,
  hops: 2,
  nextHop: "b",
  via: "Homelab",
  skewMs: null,
  ghost: false,
  unsynced: false,
};

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  );
  writeSummaryCache("c", {
    savedAt: routed.lastSeenAt,
    projects: [{ id: "p", name: "Site" }],
    threads: [{ id: "t", projectId: "p", title: "Fix footer", updatedAt: routed.lastSeenAt }],
  });
});

describe("a routed node in the sidebar", () => {
  it("shows 'via' as text and its cached threads while offline", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NodeApiProvider>
          <MemoryRouter>
            <TooltipProvider>
              <SidebarProvider>
                <NodeGroup node={routed} name={routed.name}>
                  <OfflineNodeSection node={routed} now={Date.now()} />
                </NodeGroup>
              </SidebarProvider>
            </TooltipProvider>
          </MemoryRouter>
        </NodeApiProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText("via Homelab")).toBeInTheDocument();
    expect(await screen.findByText("Fix footer")).toBeInTheDocument();
  });
});
