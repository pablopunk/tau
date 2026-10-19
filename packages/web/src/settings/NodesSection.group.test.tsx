import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DirectoryNode, Expulsion } from "@tau/protocol";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { forgetNodeApis, NodeApiProvider } from "@/nodes";
import { NodesSection } from "./NodesSection";

const node = (id: string, name: string, over: Partial<DirectoryNode> = {}): DirectoryNode => ({
  id,
  identified: true,
  name,
  os: "linux",
  tauVersion: "0.2.0",
  protocolVersion: "same",
  status: "online",
  lastSeenAt: Date.now(),
  threadCount: 2,
  links: [],
  direct: true,
  hops: 1,
  nextHop: id,
  via: null,
  skewMs: null,
  ghost: false,
  unsynced: false,
  ...over,
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

let directory: DirectoryNode[] = [];
let expulsions: Expulsion[] = [];
let self: Record<string, unknown> = {};
const calls: Array<{ method: string; url: string; body?: string }> = [];

beforeEach(() => {
  calls.length = 0;
  forgetNodeApis();
  expulsions = [];
  self = {
    nodeId: "self",
    publicKey: "k",
    name: "Mac",
    os: "darwin arm64",
    tauVersion: "0.2.0",
    protocolVersion: "same",
    linkProtocol: "l",
    capabilities: [],
  };
  directory = [node("b", "Homelab"), node("c", "Work laptop", { direct: false, hops: 2, via: "Homelab" })];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url, body: init?.body as string | undefined });
      if (url === "/api/nodes/directory") return json(directory);
      if (url === "/api/nodes/expulsions") return json(expulsions);
      if (url === "/api/nodes/self") return json(self);
      if (init?.method === "POST") return new Response(null, { status: 204 });
      return json([]);
    }),
  );
});

const renderSection = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NodeApiProvider>
        <TooltipProvider>
          <NodesSection />
        </TooltipProvider>
      </NodeApiProvider>
    </QueryClientProvider>,
  );

describe("Settings → Nodes in a group", () => {
  it("shows a routed node with hops and 'via' as text", async () => {
    renderSection();
    const row = (await screen.findByText("Work laptop")).closest("li") as HTMLElement;
    expect(within(row).getByText("2 hops · via Homelab")).toBeInTheDocument();
  });

  it("warns about clock skew beyond 120 s and not below", async () => {
    directory = [node("b", "Homelab", { skewMs: 300_000 }), node("c", "Work laptop", { skewMs: 5_000 })];
    renderSection();
    expect(await screen.findByText(/Clock skew with Homelab/)).toBeInTheDocument();
    expect(screen.queryByText(/Clock skew with Work laptop/)).toBeNull();
  });

  it("warns when the group holds 16 nodes", async () => {
    directory = Array.from({ length: 15 }, (_, index) => node(`n${index}`, `Node ${index}`));
    renderSection();
    expect(await screen.findByText(/This group has 16 nodes/)).toBeInTheDocument();
  });

  it("removes a node only after typing its name, and says it cannot undo", async () => {
    const user = userEvent.setup();
    renderSection();
    const row = (await screen.findByText("Work laptop")).closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "More actions for Work laptop" }));
    expect(screen.queryByRole("menuitem", { name: "Disconnect" })).toBeNull();
    await user.click(await screen.findByRole("menuitem", { name: "Remove from the group" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/cannot undo what the node already did/)).toBeInTheDocument();
    expect(within(dialog).getByText(/tau access rotate/)).toBeInTheDocument();
    const remove = within(dialog).getByRole("button", { name: "Remove from group" });
    expect(remove).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Type Work laptop to confirm/), "Work laptop");
    await user.click(remove);
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "POST",
        url: "/api/nodes/c/remove",
        body: JSON.stringify({ confirm: "Work laptop" }),
      }),
    );
  });

  it("lists expulsions with who removed them and who has not confirmed", async () => {
    expulsions = [
      {
        target: "x",
        targetName: "Old box",
        by: "b",
        byName: "Homelab",
        at: Date.now() - 3_600_000,
        confirmations: [],
        pending: [{ node: "c", name: "Work laptop" }],
      },
    ];
    renderSection();
    const list = await screen.findByRole("list", { name: "Removed nodes" });
    expect(within(list).getByText(/Old box was removed by Homelab 1 h ago/)).toBeInTheDocument();
    expect(within(list).getByText("Work laptop has not confirmed.")).toBeInTheDocument();
  });

  it("tells a removed node to reset its identity", async () => {
    self = { ...self, removed: { by: "Homelab", at: Date.now() } };
    renderSection();
    expect(await screen.findByText(/This node was removed from its group/)).toBeInTheDocument();
  });
});
