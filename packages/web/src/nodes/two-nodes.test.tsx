import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Node } from "@tau/protocol";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadDraft, saveDraft } from "@/conversation/composer/drafts";
import { loadNewThreadDraft, saveNewThreadDraft } from "@/lib/new-thread-draft";
import { nodeKey, scopeTarget } from "@/lib/node-keys";
import { preferences } from "@/lib/preferences";
import { AppSidebar } from "@/sidebar/AppSidebar";
import { conversation, project } from "@/sidebar/test-support";
import { forgetNodeApis, forgetNodeClients, NodeProvider, useApi } from ".";
import { writeSummaryCache } from "./summary-cache";

const HOUR = 3_600_000;
const node = (overrides: Partial<Node>): Node => ({
  id: "m1",
  name: "Homelab",
  os: "linux",
  tauVersion: "0.0.0",
  protocolVersion: "x",
  status: "online",
  lastSeenAt: Date.now(),
  threadCount: 1,
  ...overrides,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

class FakeSocket extends EventTarget {
  close() {}
  send() {}
}

interface Backend {
  nodes: Node[];
  routes: Record<string, () => Response>;
  seen: string[];
}

function stubBackend(backend: Backend) {
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      backend.seen.push(url);
      if (url === "/api/nodes") return json(backend.nodes);
      return backend.routes[url]?.() ?? json([]);
    }),
  );
}

const home = project();
const backend = (): Backend => ({ nodes: [], routes: {}, seen: [] });

function renderSidebar(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NodeProvider>
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar />
          </SidebarProvider>
        </TooltipProvider>
      </NodeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  forgetNodeApis();
  forgetNodeClients();
});

describe("sidebar with two nodes", () => {
  it("groups by node, local first, each group asking its own node", async () => {
    const data = backend();
    data.nodes = [node({}), node({ id: "m2", name: "Work laptop" })];
    data.routes = {
      "/api/projects": () => json([home]),
      "/api/conversations": () => json([conversation({ id: "c-local", title: "Local thread" })]),
      "/api/n/m1/api/projects": () => json([home]),
      "/api/n/m1/api/conversations": () => json([conversation({ id: "c-home", title: "Homelab thread" })]),
      "/api/n/m2/api/projects": () => json([home]),
      "/api/n/m2/api/conversations": () => json([conversation({ id: "c-work", title: "Laptop thread" })]),
    };
    stubBackend(data);
    renderSidebar();

    const groups = await screen.findAllByRole("group", { name: /^Local|Homelab|Work laptop/ });
    expect(groups.map((group) => group.getAttribute("data-node"))).toEqual(["local", "m1", "m2"]);
    expect(await within(groups[0] as HTMLElement).findByText("Local thread")).toBeInTheDocument();
    expect(await within(groups[1] as HTMLElement).findByText("Homelab thread")).toBeInTheDocument();
    expect(within(groups[1] as HTMLElement).queryByText("Local thread")).toBeNull();
    expect(await within(groups[2] as HTMLElement).findByText("Laptop thread")).toBeInTheDocument();
    expect(data.seen).toEqual(expect.arrayContaining(["/api/n/m1/api/conversations", "/api/conversations"]));
  });

  it("shows no group header when no node is linked", async () => {
    const data = backend();
    data.routes = {
      "/api/projects": () => json([home]),
      "/api/conversations": () => json([conversation({ title: "Only thread" })]),
    };
    stubBackend(data);
    renderSidebar();
    expect(await screen.findByText("Only thread")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Local/ })).toBeNull();
  });

  it("shows an offline node from its cache: greyed, stale, last seen, links to the calm state, no requests", async () => {
    const data = backend();
    data.nodes = [
      node({ id: "m2", name: "Work laptop", status: "offline", lastSeenAt: Date.now() - 3 * HOUR }),
    ];
    data.routes = { "/api/projects": () => json([home]), "/api/conversations": () => json([]) };
    writeSummaryCache("m2", {
      savedAt: Date.now() - 3 * HOUR,
      projects: [{ id: "p1", name: "Home" }],
      threads: [{ id: "c9", projectId: "p1", title: "Cached title", updatedAt: 1 }],
    });
    stubBackend(data);
    renderSidebar();

    const group = await screen.findByRole("group", { name: "Work laptop" });
    expect(await within(group).findByText("Offline, last seen 3 h ago")).toBeInTheDocument();
    const link = within(group).getByRole("link", { name: "Cached title" });
    expect(link).toHaveAttribute("href", "/n/m2/p/p1/c/c9");
    expect(group.querySelector("[data-stale]")).not.toBeNull();
    expect(group.querySelector("[data-slot=node-dot]")).toHaveAttribute("data-status", "offline");
    expect(data.seen.some((url) => url.startsWith("/api/n/m2"))).toBe(false);
  });

  it("isolates errors: a failing node blocks no other group", async () => {
    const data = backend();
    data.nodes = [node({})];
    data.routes = {
      "/api/projects": () => json([home]),
      "/api/conversations": () => json([conversation({ title: "Still here" })]),
      "/api/n/m1/api/projects": () => json({ error: { code: "internal", message: "Homelab broke" } }, 500),
    };
    stubBackend(data);
    renderSidebar();
    expect(await screen.findByText("Homelab broke")).toBeInTheDocument();
    expect(await screen.findByText("Still here")).toBeInTheDocument();
  });

  it("opens an offline node's thread as a calm state", async () => {
    const data = backend();
    data.nodes = [node({ id: "m2", name: "Work laptop", status: "offline", lastSeenAt: Date.now() - HOUR })];
    stubBackend(data);
    const { ConversationRoute } = await import("@/routes/ConversationRoute");
    const { Route, Routes } = await import("react-router");
    render(
      <MemoryRouter initialEntries={["/n/m2/p/p1/c/c9"]}>
        <NodeProvider>
          <Routes>
            <Route path="/n/:nodeId/p/:projectId/c/:conversationId/*" element={<ConversationRoute />} />
          </Routes>
        </NodeProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("This node is offline")).toBeInTheDocument();
    expect(screen.getByText(/Work laptop was last seen 1 h ago/)).toBeInTheDocument();
    expect(data.seen.some((url) => url.startsWith("/api/n/m2"))).toBe(false);
  });
});

describe("no cross-node cache leak", () => {
  it("the same query key holds different data under each node's provider", async () => {
    const data = backend();
    data.routes = {
      "/api/n/m1/api/projects": () => json([project({ id: "a", name: "Alpha" })]),
      "/api/n/m2/api/projects": () => json([project({ id: "b", name: "Beta" })]),
    };
    stubBackend(data);
    const Names = ({ label }: { label: string }) => {
      const api = useApi();
      const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: () => api.projects.list() });
      return <p data-testid={label}>{projects?.map((item) => item.name).join(",") ?? "…"}</p>;
    };
    render(
      <>
        <NodeProvider nodeId="m1">
          <Names label="one" />
        </NodeProvider>
        <NodeProvider nodeId="m2">
          <Names label="two" />
        </NodeProvider>
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("one")).toHaveTextContent("Alpha"));
    await waitFor(() => expect(screen.getByTestId("two")).toHaveTextContent("Beta"));
  });

  it("a node keeps one cache across provider mounts (sidebar group and thread share it)", () => {
    stubBackend(backend());
    const clients: unknown[] = [];
    const Probe = () => {
      clients.push(useQueryClient());
      return null;
    };
    render(
      <>
        <NodeProvider nodeId="m1">
          <Probe />
        </NodeProvider>
        <NodeProvider nodeId="m1">
          <Probe />
        </NodeProvider>
      </>,
    );
    expect(clients[0]).toBe(clients[1]);
  });
});

describe("per-node drafts and preferences", () => {
  it("keeps today's keys on the hub's own node and adds the id on a linked one", () => {
    expect(nodeKey("tau:last-project")).toBe("tau:last-project");
    expect(nodeKey("tau:last-project", "m1")).toBe("tau:last-project:m:m1");
    expect(scopeTarget("c1")).toBe("c1");
    expect(scopeTarget("c1", "m1")).toBe("m:m1:c1");
  });

  it("does not share a draft between two nodes with the same thread id", () => {
    saveDraft(scopeTarget("c1"), "local words");
    saveDraft(scopeTarget("c1", "m1"), "homelab words");
    expect(loadDraft(scopeTarget("c1"))).toBe("local words");
    expect(loadDraft(scopeTarget("c1", "m1"))).toBe("homelab words");
    expect(loadDraft(scopeTarget("c1", "m2"))).toBe("");
    expect(window.localStorage.getItem("tau:draft:c1")).toBe("local words");
  });

  it("scopes the new-thread draft and the eleven node preferences", () => {
    saveNewThreadDraft({ projectId: "pl", model: null, thinkingLevel: null, workspace: null });
    saveNewThreadDraft({ projectId: "pm", model: null, thinkingLevel: null, workspace: null }, "m1");
    expect(loadNewThreadDraft().projectId).toBe("pl");
    expect(loadNewThreadDraft("m1").projectId).toBe("pm");
    preferences.setLastProjectId("pl");
    preferences.setLastProjectId("pm", "m1");
    preferences.setLastModel({ provider: "a", modelId: "b" }, "m1");
    preferences.setLastThinkingLevel("high", "m1");
    preferences.setLastSeenAt("c1", 5, "m1");
    preferences.setProjectOpenOverrides({ p: true }, "m1");
    preferences.setCollapsedThreads(["t"], "m1");
    expect(preferences.getLastProjectId()).toBe("pl");
    expect(preferences.getLastProjectId("m1")).toBe("pm");
    expect(preferences.getLastModel()).toBeNull();
    expect(preferences.getLastThinkingLevel()).toBeNull();
    expect(preferences.getLastSeenAt("c1")).toBeNull();
    expect(preferences.getLastSeenAt("c1", "m1")).toBe(5);
    expect(preferences.getProjectOpenOverrides()).toEqual({});
    expect(preferences.getCollapsedThreads()).toEqual([]);
    const first = preferences.getSeenBaseline(10, "m1");
    expect(preferences.getSeenBaseline(99, "m1")).toBe(first);
    expect(window.localStorage.getItem("tau:seen-baseline")).toBeNull();
  });
});
