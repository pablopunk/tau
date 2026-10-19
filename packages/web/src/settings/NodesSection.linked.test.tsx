import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeCore, type FakeCore, linkFakeCores } from "@tau/testkit";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { forgetNodeApis, NodeApiProvider } from "@/nodes";
import { NodesSection } from "./NodesSection";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** The browser of one fake tau: the few routes the Nodes page reads, answered by that tau's core. */
function browserOf(core: FakeCore) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/nodes") return json(await core.nodes.list());
      if (url === "/api/nodes/self") return json(await core.nodes.self());
      if (url === "/api/providers") return json(await core.providers.list());
      if (url === "/api/update") return json(await core.updates.status());
      return json([]);
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NodeApiProvider>
        <TooltipProvider>
          <NodesSection />
        </TooltipProvider>
      </NodeApiProvider>
    </QueryClientProvider>,
  );
}

const rows = () => [...document.querySelectorAll('[data-slot="node-row"]')] as HTMLElement[];

beforeEach(() => forgetNodeApis());
afterEach(() => vi.unstubAllGlobals());

describe("two taus linked both ways", () => {
  async function linked() {
    const a = createFakeCore({ configured: true, nodeName: "Alpha", nodeOs: "darwin arm64" });
    const b = createFakeCore({ configured: true, nodeName: "Beta", nodeOs: "linux x64" });
    await linkFakeCores(a, b);
    return { a, b };
  }

  it("the dialler sees the acceptor as a node it connected to", async () => {
    const { a } = await linked();
    browserOf(a);
    await screen.findByText("Beta");
    expect(within(rows()[0] as HTMLElement).getByText("Alpha")).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
    const beta = screen.getByText("Beta").closest("li") as HTMLElement;
    expect(within(beta).getByText("This node connected to it: Linked")).toBeInTheDocument();
    expect(within(beta).getByText(/Linux/)).toBeInTheDocument();
  });

  it("the acceptor sees the dialler, with the link the other way", async () => {
    const { b } = await linked();
    browserOf(b);
    await screen.findByText("Alpha");
    expect(within(rows()[0] as HTMLElement).getByText("Beta")).toBeInTheDocument();
    const alpha = screen.getByText("Alpha").closest("li") as HTMLElement;
    expect(within(alpha).getByText("It connected to this node: Linked")).toBeInTheDocument();
    expect(within(alpha).getByText(/macOS/)).toBeInTheDocument();
  });
});
