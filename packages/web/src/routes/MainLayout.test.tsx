import type { Node } from "@tau/protocol";
import { createFakeCore } from "@tau/testkit";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialogProvider } from "@/app/settings-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { forgetNodeApis, forgetNodeClients, NodeProvider } from "@/nodes";
import { project } from "@/sidebar/test-support";
import { MainLayout } from "./MainLayout";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

class FakeSocket extends EventTarget {
  close() {}
  send() {}
}

const peer = (overrides: Partial<Node> = {}): Node => ({
  id: "n1",
  identified: true,
  name: "Homelab",
  os: "linux",
  tauVersion: "0.2.0",
  protocolVersion: "p",
  status: "online",
  lastSeenAt: Date.now(),
  threadCount: 0,
  links: [{ direction: "accepted", state: "linked", message: null, since: null }],
  ...overrides,
});

const settings = { ...(await createFakeCore({ configured: false }).settings.get()), setupSkipped: true };
const configured = createFakeCore({ configured: true });
const models = await configured.models.list();
const connected = await configured.providers.list();

let nodes: Node[] = [];
let localProviders: unknown[] = [];
let peerProviders: unknown[] = connected;
const seen: string[] = [];

function route(url: string): Response {
  seen.push(url);
  if (url === "/api/nodes") return json(nodes);
  if (url === "/api/nodes/self")
    return json({ nodeId: "me", publicKey: "k", name: "Mac", os: "darwin arm64", tauVersion: "0.2.0" });
  if (url === "/api/providers") return json(localProviders);
  if (url === "/api/n/n1/api/providers") return json(peerProviders);
  if (url === "/api/settings" || url === "/api/n/n1/api/settings") return json(settings);
  if (url === "/api/models") return json([]);
  if (url === "/api/n/n1/api/models") return json(models);
  if (url.endsWith("/api/projects") || url === "/api/projects") return json([project()]);
  return json([]);
}

beforeEach(() => {
  window.localStorage.clear();
  forgetNodeApis();
  forgetNodeClients();
  seen.length = 0;
  nodes = [];
  localProviders = [];
  peerProviders = connected;
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => route(url)),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderLayout(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NodeProvider>
        <TooltipProvider>
          <SettingsDialogProvider>
            <MainLayout />
          </SettingsDialogProvider>
        </TooltipProvider>
      </NodeProvider>
    </MemoryRouter>,
  );
}

describe("MainLayout with a local node that has no provider", () => {
  it("renders, says it is not set up and offers Set up when no node has a provider", async () => {
    renderLayout();
    expect(await screen.findByText("This node is not set up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set up" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New thread" })).toBeInTheDocument();
  });

  it("starts new threads on the first node that has a provider", async () => {
    nodes = [peer()];
    renderLayout();
    await waitFor(() => expect(seen).toContain("/api/n/n1/api/models"));
    expect(await screen.findByRole("heading", { name: "New thread" })).toBeInTheDocument();
    expect(screen.queryByText("This node is not set up")).toBeNull();
  });

  it("falls back to this node, not set up, when the peers have no provider either", async () => {
    nodes = [peer()];
    peerProviders = [];
    renderLayout();
    expect(await screen.findByText("This node is not set up")).toBeInTheDocument();
  });

  it("keeps this node when it has a provider, even with peers", async () => {
    nodes = [peer()];
    localProviders = connected;
    renderLayout();
    await screen.findByRole("heading", { name: "New thread" });
    expect(seen).not.toContain("/api/n/n1/api/models");
  });

  it("an explicit ?node= wins over the default target", async () => {
    nodes = [peer()];
    renderLayout("/new?node=n1");
    await waitFor(() => expect(seen).toContain("/api/n/n1/api/models"));
  });
});
