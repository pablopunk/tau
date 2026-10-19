import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Node } from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { forgetNodeApis, NodeApiProvider } from "@/nodes";
import { NodesSection } from "./NodesSection";

const nodes: Node[] = [
  {
    id: "m1",
    identified: true,
    links: [{ direction: "accepted", state: "linked", message: null, since: null }],
    name: "Homelab",
    os: "linux",
    tauVersion: "0.1.0",
    protocolVersion: "oldprotocolhash",
    status: "update-required",
    lastSeenAt: Date.now(),
    threadCount: 3,
  },
  {
    id: "m2",
    identified: true,
    links: [{ direction: "accepted", state: "unreachable", message: null, since: null }],
    name: "Work laptop",
    os: "darwin",
    tauVersion: "0.2.0",
    protocolVersion: "same",
    status: "offline",
    lastSeenAt: Date.now() - 3 * 3_600_000,
    threadCount: 1,
  },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const calls: Array<{ method: string; url: string }> = [];
let updateStatus: Record<string, unknown> = {
  current: "0.2.0",
  latest: null,
  checkedAt: null,
  behind: false,
};
const connected = await createFakeCore({ configured: true }).providers.list();
let providers: unknown[] = connected;
beforeEach(() => {
  calls.length = 0;
  forgetNodeApis();
  providers = connected;
  updateStatus = { current: "0.2.0", latest: null, checkedAt: null, behind: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url });
      if (url === "/api/nodes") return json(nodes.map((node) => ({ ...node })));
      if (url === "/api/providers") return json(providers);
      if (url === "/api/nodes/self")
        return json({
          nodeId: "self",
          publicKey: "k",
          name: "Mac",
          os: "darwin arm64",
          tauVersion: "0.2.0",
          protocolVersion: "same",
          linkProtocol: "l",
          capabilities: [],
        });
      if (url === "/api/update") return json(updateStatus);
      if (url === "/api/update/refresh") {
        updateStatus = { ...updateStatus, latest: "0.3.0", checkedAt: Date.now(), behind: true };
        return json(updateStatus);
      }
      if (url.includes("/api/pair")) {
        return json({
          kind: "node",
          code: "code",
          shortCode: "ABCD2345",
          link: "https://node.example/pair#ABCD2345",
          expiresAt: Date.now() + 300_000,
        });
      }
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
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

describe("Settings → Nodes", () => {
  it("lists this node first, with its own name and OS, then each node with its state and links", async () => {
    renderSection();
    await screen.findByText("Work laptop");
    const rows = [...document.querySelectorAll('[data-slot="node-row"]')] as HTMLElement[];
    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText("Mac")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText(/macOS · 0 threads/)).toBeInTheDocument();
    const work = screen.getByText("Work laptop").closest("li") as HTMLElement;
    expect(within(work).getByText(/macOS · 1 thread · Offline, last seen 3 h ago/)).toBeInTheDocument();
    expect(within(work).getByRole("button", { name: /Open settings of Work laptop/ })).toBeDisabled();
    const links = within(work).getByRole("list", { name: "Links of Work laptop" });
    expect(within(links).getByText("It connected to this node: Unreachable")).toBeInTheDocument();
  });

  it("tells the direction of each link as text, hides a standby spare and labels a duplicate", async () => {
    nodes.push({
      ...(nodes[1] as Node),
      id: "m4",
      name: "Both ways",
      status: "online",
      links: [
        { direction: "dialled", state: "linked", message: null, since: null },
        { direction: "accepted", state: "standby", message: null, since: null },
      ],
    });
    nodes.push({
      ...(nodes[1] as Node),
      id: "m5",
      name: "Clone",
      links: [{ direction: "accepted", state: "duplicate", message: null, since: null }],
    });
    try {
      renderSection();
      const both = (await screen.findByText("Both ways")).closest("li") as HTMLElement;
      const list = within(both).getByRole("list", { name: "Links of Both ways" });
      expect(
        within(list)
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual(["This node connected to it: Linked"]);
      const clone = screen.getByText("Clone").closest("li") as HTMLElement;
      expect(within(clone).getByText("It connected to this node: Duplicate identity")).toBeInTheDocument();
    } finally {
      nodes.splice(2);
    }
  });

  it("says Not set up with a Set up action when this node has no provider", async () => {
    providers = [];
    renderSection();
    const rows = () => [...document.querySelectorAll('[data-slot="node-row"]')] as HTMLElement[];
    await waitFor(() => expect(within(rows()[0] as HTMLElement).getByText("Not set up")).toBeInTheDocument());
    expect(
      within(rows()[0] as HTMLElement).getByRole("button", { name: "Set up this node" }),
    ).toBeInTheDocument();
  });

  it("has no Not set up while this node has a provider", async () => {
    renderSection();
    await screen.findByText("Work laptop");
    expect(screen.queryByText("Not set up")).toBeNull();
  });

  it("shows the update command for a node that needs an update", async () => {
    renderSection();
    const home = (await screen.findByText("Homelab")).closest("li") as HTMLElement;
    expect(within(home).getByText(/Update tau on Homelab/, { selector: "p" })).toBeInTheDocument();
    expect(within(home).getByText("npm i -g @pablopunk/tau@latest")).toBeInTheDocument();
    expect(within(home).getByRole("button", { name: "Copy update command" })).toBeInTheDocument();
  });

  it("shows versions and chips: behind, up to date, unknown, never crashes on an empty version", async () => {
    nodes.push({ ...(nodes[1] as Node), id: "m3", name: "Fresh", tauVersion: "" });
    updateStatus = { current: "0.2.0", latest: "0.2.0", checkedAt: Date.now(), behind: false };
    try {
      renderSection();
      const home = (await screen.findByText("Homelab")).closest("li") as HTMLElement;
      await within(home).findByText("Behind, latest 0.2.0");
      expect(within(home).getByText("0.1.0")).toBeInTheDocument();
      const work = screen.getByText("Work laptop").closest("li") as HTMLElement;
      expect(within(work).getByText("Up to date")).toBeInTheDocument();
      const fresh = screen.getByText("Fresh").closest("li") as HTMLElement;
      expect(within(fresh).getByText("Version unknown")).toBeInTheDocument();
      expect(screen.getByText("1 node is behind")).toBeInTheDocument();
    } finally {
      nodes.pop();
    }
  });

  it("counts this node when it is behind, and hides the banner at 0", async () => {
    updateStatus = { current: "0.0.1", latest: "0.1.5", checkedAt: Date.now(), behind: true };
    renderSection();
    expect(await screen.findByText("2 nodes are behind")).toBeInTheDocument();
    const own = screen.getByText("Mac").closest("li") as HTMLElement;
    expect(within(own).getByText("Behind, latest 0.1.5")).toBeInTheDocument();
  });

  it("no banner when latest is unknown or everything is current", async () => {
    renderSection();
    await screen.findByText("Homelab");
    expect(await screen.findByText(/Latest unknown/)).toBeInTheDocument();
    expect(screen.queryByText(/behind/)).toBeNull();
    expect(screen.getAllByText("Version unknown").length).toBeGreaterThan(0);
  });

  it("Check again posts a refresh and shows the new latest", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Check again" }));
    expect(await screen.findByText(/Latest known: 0.3.0, checked just now/)).toBeInTheDocument();
    expect(calls).toContainEqual({ method: "POST", url: "/api/update/refresh" });
    expect(await screen.findByText("3 nodes are behind")).toBeInTheDocument();
  });

  it("disconnects only after a confirmation", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "More actions for Homelab" }));
    await user.click(await screen.findByRole("menuitem", { name: "Disconnect" }));
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(calls).toContainEqual({ method: "DELETE", url: "/api/nodes/m1" }));
  });

  it("forgets a node locally only after a confirmation", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "More actions for Homelab" }));
    await user.click(await screen.findByRole("menuitem", { name: "Forget on this node" }));
    expect(calls.some((call) => call.url.endsWith("/forget"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Forget" }));
    await waitFor(() => expect(calls).toContainEqual({ method: "POST", url: "/api/nodes/m1/forget" }));
  });

  it("offers Reset identity on a node that removed this one, after a confirmation", async () => {
    nodes.push({
      ...(nodes[1] as Node),
      id: "m6",
      name: "Strict",
      links: [{ direction: "dialled", state: "refused", message: "Removed from the group", since: null }],
    });
    try {
      const user = userEvent.setup();
      renderSection();
      const strict = (await screen.findByText("Strict")).closest("li") as HTMLElement;
      await user.click(within(strict).getByRole("button", { name: "Reset identity" }));
      expect(calls.some((call) => call.url === "/api/nodes/identity/reset")).toBe(false);
      await user.click(screen.getAllByRole("button", { name: "Reset identity" }).at(-1) as HTMLElement);
      await waitFor(() => expect(calls).toContainEqual({ method: "POST", url: "/api/nodes/identity/reset" }));
    } finally {
      nodes.pop();
    }
  });

  it("connect on this node: the link command and the code command are shown, and the dialog says every node gets full power", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Connect a node to this node" }));
    expect(
      await screen.findByText("npx -y @pablopunk/tau@latest connect 'https://node.example/pair#ABCD2345'"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("npx -y @pablopunk/tau@latest connect ABCD2345 --node 'https://node.example'"),
    ).toBeInTheDocument();
    expect(calls).toContainEqual({ method: "POST", url: "/api/pair?kind=node" });
    expect(screen.getByRole("note")).toHaveTextContent(
      /Every node in the group gets full power over every other node/,
    );
    expect(document.body.textContent).not.toMatch(/\bhub\b/i);
  });

  it("every node has Connect a node: the code is minted on that node", async () => {
    nodes.push({ ...(nodes[1] as Node), id: "m7", name: "Nas", status: "online" });
    try {
      const user = userEvent.setup();
      renderSection();
      await user.click(await screen.findByRole("button", { name: "Connect a node to Nas" }));
      await screen.findByText(/connect 'https:\/\/node.example/);
      expect(calls).toContainEqual({ method: "POST", url: "/api/n/m7/api/pair?kind=node" });
      expect(screen.getByRole("note")).toHaveTextContent(/full power over every other node/);
    } finally {
      nodes.pop();
    }
  });

  it("keeps the two searchable setting rows", async () => {
    const { container } = renderSection();
    await screen.findByText("Homelab");
    const ids = [...container.querySelectorAll("[data-setting-id]")].map((el) =>
      el.getAttribute("data-setting-id"),
    );
    expect(ids).toEqual(["nodes", "connect-node"]);
  });
});
