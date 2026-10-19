import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeApiProvider } from "@/nodes";
import { SetupScreen } from "./SetupScreen";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } })),
  );
});
afterEach(() => vi.unstubAllGlobals());

const renderSetup = (props: Parameters<typeof SetupScreen>[0]) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NodeApiProvider>
        <SetupScreen {...props} />
      </NodeApiProvider>
    </QueryClientProvider>,
  );

describe("SetupScreen: Use my other nodes", () => {
  it("is not offered without a known peer", () => {
    renderSetup({ keyConfigured: false });
    expect(screen.queryByRole("button", { name: "Use my other nodes" })).toBeNull();
  });

  it("is offered when the gate knows a peer, and calls it", async () => {
    const onUse = vi.fn();
    renderSetup({ keyConfigured: false, onUseOtherNodes: onUse });
    expect(screen.getByRole("region", { name: "Use other nodes" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Use my other nodes" }));
    expect(onUse).toHaveBeenCalledOnce();
  });

  it("stays available while setting up", () => {
    renderSetup({ keyConfigured: true, onUseOtherNodes: () => {} });
    expect(screen.getByRole("button", { name: "Use my other nodes" })).toBeInTheDocument();
  });
});
