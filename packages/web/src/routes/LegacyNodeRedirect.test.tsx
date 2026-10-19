import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Node } from "@tau/protocol";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileNodeIds } from "@/lib/node-id-reconcile";
import { forgetNodeApis, NodeApiProvider } from "@/nodes";
import { LegacyNodeRedirect } from "./LegacyNodeRedirect";

function Where() {
  const { pathname, search } = useLocation();
  return <p>{pathname + search}</p>;
}

const peer = (id: string, identified: boolean): Node => ({
  id,
  identified,
  name: "Homelab",
  os: "linux",
  tauVersion: "0.2.0",
  protocolVersion: "p",
  status: "online",
  lastSeenAt: 0,
  threadCount: 0,
  links: [],
});

let list: Node[] = [];

beforeEach(() => {
  window.localStorage.clear();
  forgetNodeApis();
  list = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify(list), { headers: { "content-type": "application/json" } }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NodeApiProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/m/*" element={<LegacyNodeRedirect />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </NodeApiProvider>
    </QueryClientProvider>,
  );
}

describe("LegacyNodeRedirect", () => {
  it("falls back to the same id when the node list does not know it", async () => {
    renderAt("/m/abc/p/p1/c/c1/terminal?x=1");
    expect(await screen.findByText("/n/abc/p/p1/c/c1/terminal?x=1")).toBeTruthy();
  });

  it("resolves the old device id to the nodeId it became", async () => {
    reconcileNodeIds(window.localStorage, [peer("dev1", false)]);
    list = [peer("NODEID", true)];
    renderAt("/m/dev1/p/p1/c/c1");
    expect(await screen.findByText("/n/NODEID/p/p1/c/c1")).toBeTruthy();
  });
});
