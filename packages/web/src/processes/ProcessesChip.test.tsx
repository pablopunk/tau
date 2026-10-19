import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProcessInfo } from "@tau/protocol";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiOfNode } from "@/nodes/node-apis";
import { NodeApiProvider } from "@/nodes/node-context";
import { ProcessesChip } from "./ProcessesChip";

const api = apiOfNode();

const info = (overrides: Partial<ProcessInfo>): ProcessInfo => ({
  id: "p1",
  conversationId: "c1",
  name: "dev server",
  command: "pnpm dev",
  state: "running",
  exitCode: null,
  startedAt: 1,
  urls: ["http://localhost:5173/"],
  kind: "process",
  ...overrides,
});

function renderChip() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NodeApiProvider>
        <ProcessesChip conversationId="c1" />
      </NodeApiProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("ProcessesChip", () => {
  it("renders nothing without running processes", async () => {
    const list = vi.spyOn(api.processes, "list").mockResolvedValue([info({ state: "killed" })]);
    const { container } = renderChip();
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the running count, lists details and stops a process", async () => {
    vi.spyOn(api.processes, "list").mockResolvedValue([info({})]);
    vi.spyOn(api.processes, "logs").mockResolvedValue("ready in 100ms");
    const stop = vi.spyOn(api.processes, "stop").mockResolvedValue();
    renderChip();
    await userEvent.click(await screen.findByRole("button", { name: "1 running processes" }));
    expect(await screen.findByText("pnpm dev")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "http://localhost:5173/" })).toHaveAttribute(
      "href",
      "http://localhost:5173/",
    );
    expect(await screen.findByText("ready in 100ms")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stop).toHaveBeenCalledWith("p1");
  });
});
